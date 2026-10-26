// Autonomous Operator: a daily operating cycle per company.
//   1. Sync verified revenue from the company's Stripe account.
//   2. Collect real metrics (revenue, traffic, leads, evidence, tasks).
//   3. A CEO agent writes a brief and recommends next actions from those
//      metrics only.
//   4. Autopilot also drafts internal work for up to two low-risk actions.
// Nothing in a cycle publishes, messages customers, spends money or changes
// prices: external actions are always returned as proposals for the founder.
const MODES = ["copilot", "supervised", "autopilot"];
const OWNERS = ["Strategy", "Research", "Product", "Growth", "Sales", "Operations", "Finance", "Compliance"];
const MAX_AUTOPILOT_DRAFTS = 2;

function normalizeSettings(input = {}, previous = {}) {
  const cap = Math.round(Number(input.dailyTokenCap ?? previous.dailyTokenCap ?? 30000));
  return {
    mode: MODES.includes(input.mode) ? input.mode : MODES.includes(previous.mode) ? previous.mode : "copilot",
    paused: typeof input.paused === "boolean" ? input.paused : previous.paused === true,
    dailyTokenCap: Math.min(200000, Math.max(5000, Number.isFinite(cap) ? cap : 30000)),
    updatedAt: new Date().toISOString()
  };
}

function buildMetrics({ state = {}, page = {}, validationCount = 0, orders = [], stripeConnected = false }) {
  const offers = Array.isArray(state.offers) ? state.offers : [], tasks = Array.isArray(state.executionTasks) ? state.executionTasks : [];
  const currency = orders[0]?.currency || "USD", sameCurrency = orders.filter(order => order.currency === currency);
  const gross = sameCurrency.reduce((sum, order) => sum + Number(order.amount_minor || 0), 0), refunded = sameCurrency.reduce((sum, order) => sum + Number(order.refunded_minor || 0), 0);
  const weekAgo = Date.now() - 7 * 86400000;
  return {
    company: { hasPlan: Boolean(state.plan), planName: state.plan?.name || null, customer: state.plan?.customer || null, planScore: Number.isFinite(Number(state.evaluation?.score)) ? Number(state.evaluation.score) : null, approved: state.approved === true },
    revenue: { currency, grossMinor: gross, refundedMinor: refunded, netMinor: gross - refunded, orders: orders.length, ordersLast7Days: orders.filter(order => Date.parse(order.paid_at) >= weekAgo).length, liveModeOrders: orders.filter(order => order.mode === "live").length, stripeConnected },
    offers: { total: offers.length, live: offers.filter(offer => offer.status === "active" && offer.checkout?.url).length },
    funnel: { pagePublished: Boolean(page.published), views: Number(page.views || 0), signups: Number(page.signups || 0), newLeads: Number(page.newLeads || 0), signupRate: page.views ? Number((page.signups / page.views).toFixed(4)) : null },
    evidence: { customerInterviews: validationCount },
    execution: { openTasks: tasks.filter(task => task.status !== "done").length, blockedTasks: tasks.filter(task => task.status === "blocked").length }
  };
}

const briefSchema = {
  type: "object", additionalProperties: false, required: ["headline", "summary", "whatChanged", "risks", "recommendedActions"],
  properties: {
    headline: { type: "string", maxLength: 140 }, summary: { type: "string", maxLength: 700 },
    whatChanged: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 5 },
    risks: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 4 },
    recommendedActions: { type: "array", maxItems: 5, items: { type: "object", additionalProperties: false, required: ["title", "owner", "why", "expectedImpact", "kind", "requiresApproval"], properties: {
      title: { type: "string", maxLength: 140 }, owner: { type: "string", enum: OWNERS }, why: { type: "string", maxLength: 300 },
      expectedImpact: { type: "string", maxLength: 200 }, kind: { type: "string", enum: ["internal", "external"] }, requiresApproval: { type: "boolean" }
    } } }
  }
};

const action = (title, owner, why, expectedImpact, kind) => ({ title, owner, why, expectedImpact, kind, requiresApproval: kind === "external" });

// Rule-based brief used when no model is configured. It is labelled as such.
function templateBrief(metrics) {
  const actions = [], m = metrics;
  if (!m.company.hasPlan) actions.push(action("Generate the launch strategy", "Strategy", "No plan exists yet, so no other work can be focused.", "A reviewed plan for every agent to follow", "internal"));
  if (m.company.hasPlan && !m.offers.total) actions.push(action("Draft the first paid offer", "Finance", "There is nothing for customers to buy yet.", "A priced offer ready to go live", "internal"));
  if (m.offers.total && !m.revenue.stripeConnected) actions.push(action("Connect the company's Stripe account", "Finance", "Offers cannot take payment until Stripe is connected.", "Checkout becomes possible", "external"));
  if (m.revenue.stripeConnected && m.offers.total && !m.offers.live) actions.push(action("Take the strongest offer live", "Sales", "Stripe is connected but no offer has a checkout link.", "Customers can pay", "external"));
  if (m.company.hasPlan && !m.funnel.pagePublished) actions.push(action("Publish the launch page", "Growth", "No public page is collecting visitors or signups.", "A measurable traffic and signup funnel", "external"));
  if (m.funnel.views >= 50 && (m.funnel.signupRate ?? 0) < 0.02) actions.push(action("Rewrite the launch page headline and offer", "Growth", `${m.funnel.views} visits converted at ${((m.funnel.signupRate || 0) * 100).toFixed(1)}%.`, "Higher signup rate", "internal"));
  if (m.funnel.newLeads) actions.push(action(`Follow up with ${m.funnel.newLeads} new lead${m.funnel.newLeads === 1 ? "" : "s"}`, "Sales", "New signups have not been contacted.", "Conversations that can turn into orders", "external"));
  if (m.evidence.customerInterviews < 5) actions.push(action(`Run customer interviews (${m.evidence.customerInterviews}/5 recorded)`, "Research", "Demand and willingness to pay are still unproven.", "Evidence to confirm or change the offer", "external"));
  const net = (m.revenue.netMinor / 100).toFixed(2);
  return {
    headline: m.revenue.orders ? `${m.revenue.orders} verified order${m.revenue.orders === 1 ? "" : "s"} · ${m.revenue.currency} ${net} net` : m.company.hasPlan ? "No verified revenue yet. Focus on getting the first paying customer." : "Start by defining the company.",
    summary: `Rule-based review (no AI model configured). ${m.funnel.views} page visits, ${m.funnel.signups} signups, ${m.offers.live} live offer${m.offers.live === 1 ? "" : "s"}, ${m.evidence.customerInterviews} customer interviews, ${m.execution.openTasks} open tasks.`,
    whatChanged: [], risks: m.execution.blockedTasks ? [`${m.execution.blockedTasks} task${m.execution.blockedTasks === 1 ? " is" : "s are"} blocked`] : [],
    recommendedActions: actions.slice(0, 5)
  };
}

// External actions can never skip founder approval, whatever the model says.
function enforceActionSafety(brief) {
  const actions = (Array.isArray(brief.recommendedActions) ? brief.recommendedActions : []).slice(0, 5).map(item => {
    const kind = item.kind === "internal" ? "internal" : "external";
    return { title: String(item.title || "").slice(0, 140), owner: OWNERS.includes(item.owner) ? item.owner : "Operations", why: String(item.why || "").slice(0, 300), expectedImpact: String(item.expectedImpact || "").slice(0, 200), kind, requiresApproval: kind === "external" ? true : item.requiresApproval === true };
  });
  return { headline: String(brief.headline || "").slice(0, 140), summary: String(brief.summary || "").slice(0, 700), whatChanged: (brief.whatChanged || []).slice(0, 5).map(String), risks: (brief.risks || []).slice(0, 4).map(String), recommendedActions: actions };
}

const draftSchema = {
  type: "object", additionalProperties: false, required: ["title", "deliverable", "checklist", "nextStep"],
  properties: { title: { type: "string", maxLength: 140 }, deliverable: { type: "string", maxLength: 2400 }, checklist: { type: "array", items: { type: "string", maxLength: 200 }, maxItems: 6 }, nextStep: { type: "string", maxLength: 240 } }
};

const RULES = "Use only the company metrics and context provided. Never invent numbers, customers, results, or research. Revenue figures are verified Stripe payments; projections must be labelled as estimates. Do not promise income.";

function createOperator({ supabase, router, ledger, syncRevenue, billingEnabled, planRules, assertAiBudget }) {
  async function scheduledAccess(workspace) {
    const settings = normalizeSettings(workspace.state?.operatingMode);
    if (settings.paused) return { allowed: false, reason: "Operator is paused" };
    let ceiling = 250000;
    if (billingEnabled()) {
      const subscription = await supabase.adminGetSubscription(workspace.user_id);
      if (!subscription || !["active", "trialing"].includes(subscription.status) || !planRules[subscription.tier]) return { allowed: false, reason: "Scheduled cycles need an active plan. You can still run a cycle manually." };
      ceiling = planRules[subscription.tier].tokenCeiling;
    }
    try { assertAiBudget(workspace.state || {}, ceiling, await supabase.adminWorkspaceTokens(workspace.id)); }
    catch (error) { return { allowed: false, reason: error.message }; }
    return { allowed: true };
  }

  return {
    scheduledAccess,

    // Creates the run record. Returns skip=true when the daily cap is spent.
    async startRun({ workspaceId, trigger }) {
      const workspace = await supabase.adminGetWorkspace(workspaceId, "id,user_id,name,state");
      if (!workspace) throw new Error("Workspace not found");
      const settings = normalizeSettings(workspace.state?.operatingMode), startedAt = new Date().toISOString();
      const spentToday = await supabase.adminTokensSince(workspaceId, new Date(Date.now() - 86400000).toISOString(), "operator");
      const skip = spentToday >= settings.dailyTokenCap ? `Daily operator token cap reached (${spentToday.toLocaleString()} of ${settings.dailyTokenCap.toLocaleString()})` : null;
      const run = await supabase.insertOperatorRun({ workspace_id: workspaceId, trigger, mode: settings.mode, status: skip ? "skipped" : "running", error: skip, started_at: startedAt, finished_at: skip ? startedAt : null });
      return { runId: run.id, workspaceId, userId: workspace.user_id, mode: settings.mode, skip };
    },

    async collect({ workspaceId }) {
      const warnings = [];
      const connection = await supabase.getPaymentConnection(workspaceId).catch(() => null);
      if (connection) {
        try { const sync = await syncRevenue(workspaceId); warnings.push(...(sync.warnings || [])); }
        catch (error) { warnings.push(`Revenue sync failed: ${String(error.message).slice(0, 160)}`); }
      }
      const workspace = await supabase.adminGetWorkspace(workspaceId, "id,name,state");
      const [page, validationCount, orders] = await Promise.all([supabase.adminPageMetrics(workspaceId), supabase.adminValidationCount(workspaceId), supabase.adminListOrders(workspaceId)]);
      const metrics = buildMetrics({ state: workspace?.state || {}, page, validationCount, orders, stripeConnected: Boolean(connection) });
      return { metrics, warnings, company: workspace?.name || "Company", plan: workspace?.state?.plan || null };
    },

    async brief({ workspaceId, userId, context }) {
      const { result, contribution, warnings } = await router.generateAgentTask({ company: context.company, plan: context.plan, metrics: context.metrics }, () => templateBrief(context.metrics), briefSchema, {
        role: "CEO Agent", schemaName: "operator_brief", tier: "reasoning",
        instructions: `You are Nova.Ai's CEO Agent running a daily operating review for this company. Explain in plain language what the metrics show, the biggest risk, and the 3-5 highest-impact next actions toward the first or next paying customers. Mark an action "external" if it would publish, contact anyone, spend money, change live prices or touch a connected account; those always require founder approval. Mark "internal" only for drafting, analysis or planning. ${RULES}`
      });
      await ledger.record(contribution, { workspaceId, userId, operation: "operator-brief" });
      return { brief: enforceActionSafety(result), model: contribution.model, tokens: Number(contribution.usage?.totalTokens || 0), warnings };
    },

    // Autopilot only: drafts work for internal actions that need no approval.
    async draftInternalWork({ workspaceId, userId, mode, context, brief }) {
      if (mode !== "autopilot") return { drafts: [], tokens: 0 };
      const eligible = brief.recommendedActions.filter(item => item.kind === "internal" && !item.requiresApproval).slice(0, MAX_AUTOPILOT_DRAFTS);
      const drafts = [];
      let tokens = 0;
      for (const item of eligible) {
        const { result, contribution } = await router.generateAgentTask({ company: context.company, plan: context.plan, metrics: context.metrics, action: item }, () => ({ title: item.title, deliverable: "Template: no AI model is configured, so no draft was produced.", checklist: [], nextStep: "Configure an AI model or assign this to the AI team." }), draftSchema, {
          role: `${item.owner} Agent`, schemaName: "operator_draft", tier: "reasoning",
          instructions: `You are Nova.Ai's ${item.owner} Agent on Autopilot. Produce the internal draft for this action (for example copy, an analysis, a checklist or a plan) that the founder can review and use. This is a draft only: do not claim anything was published, sent, or changed. ${RULES}`
        });
        await ledger.record(contribution, { workspaceId, userId, operation: "operator-draft" });
        tokens += Number(contribution.usage?.totalTokens || 0);
        drafts.push({ action: item.title, owner: item.owner, status: contribution.model === "Demo engine" ? "template" : "drafted", ...result });
      }
      return { drafts, tokens };
    },

    async finish({ runId, values }) {
      await supabase.updateOperatorRun(runId, { ...values, finished_at: new Date().toISOString() });
      return true;
    }
  };
}

module.exports = { createOperator, normalizeSettings, buildMetrics, templateBrief, enforceActionSafety, briefSchema, MODES };
