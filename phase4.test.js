const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
process.env.NOVA_ENCRYPTION_KEY = "b".repeat(64);
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { createOperator, normalizeSettings, buildMetrics, templateBrief, enforceActionSafety } = require("./operator");
const { createRevenueEngine } = require("./revenue-engine");
const { assertAiBudget } = require("./ai-budget");
const { PLAN_RULES } = require("./entitlements");
const router = require("./router");
const secretBox = require("./secret-box");

test("operator settings are clamped and default to Copilot", () => {
  assert.deepEqual(({ ...normalizeSettings({}), updatedAt: 0 }), { mode: "copilot", paused: false, dailyTokenCap: 30000, updatedAt: 0 });
  const settings = normalizeSettings({ mode: "rogue", dailyTokenCap: 10 }, { mode: "autopilot", paused: true });
  assert.deepEqual([settings.mode, settings.paused, settings.dailyTokenCap], ["autopilot", true, 5000]);
  assert.equal(normalizeSettings({ dailyTokenCap: 9e9 }).dailyTokenCap, 200000);
});

test("metrics come from real state, page, evidence and verified orders", () => {
  const metrics = buildMetrics({ state: { plan: { name: "Acme" }, evaluation: { score: 80 }, offers: [{ status: "active", checkout: { url: "https://buy.stripe.com/x" } }, { status: "draft" }], executionTasks: [{ status: "blocked" }, { status: "done" }] }, page: { published: true, views: 200, signups: 6, newLeads: 2 }, validationCount: 3, orders: [{ amount_minor: 9900, refunded_minor: 900, currency: "USD", mode: "live", paid_at: new Date().toISOString() }], stripeConnected: true });
  assert.deepEqual([metrics.revenue.netMinor, metrics.revenue.ordersLast7Days, metrics.offers.live, metrics.funnel.signupRate, metrics.execution.blockedTasks], [9000, 1, 1, 0.03, 1]);
});

test("the rule-based brief recommends the next missing step", () => {
  const empty = templateBrief(buildMetrics({ state: {} }));
  assert.equal(empty.recommendedActions[0].title, "Generate the launch strategy");
  const noStripe = templateBrief(buildMetrics({ state: { plan: { name: "A" }, offers: [{ status: "draft" }] } }));
  const stripe = noStripe.recommendedActions.find(item => /Stripe/.test(item.title));
  assert.equal(stripe.kind, "external");
  assert.equal(stripe.requiresApproval, true);
  assert.match(noStripe.summary, /^Rule-based/);
});

test("external actions always require approval, whatever the model returns", () => {
  const safe = enforceActionSafety({ headline: "h", summary: "s", recommendedActions: [{ title: "Email all leads", owner: "Sales", kind: "external", requiresApproval: false }, { title: "Analyse churn", owner: "Hacker", kind: "internal", requiresApproval: false }, { title: "Odd", kind: "weird" }] });
  assert.deepEqual(safe.recommendedActions.map(item => [item.kind, item.requiresApproval, item.owner]), [["external", true, "Sales"], ["internal", false, "Operations"], ["external", true, "Operations"]]);
});

function fakeSupabase(overrides = {}) {
  const runs = [];
  return {
    runs,
    adminGetWorkspace: async (id) => ({ id, user_id: "u1", name: "Acme", state: { plan: { name: "Acme" }, offers: [], operatingMode: { mode: "autopilot", paused: false, dailyTokenCap: 30000 } } }),
    adminTokensSince: async () => 0,
    insertOperatorRun: async row => { runs.push(row); return { id: `run-${runs.length}` }; },
    updateOperatorRun: async (id, values) => runs.push({ id, ...values }),
    getPaymentConnection: async () => null,
    adminPageMetrics: async () => ({ published: false, views: 0, signups: 0, newLeads: 0 }),
    adminValidationCount: async () => 1,
    adminListOrders: async () => [],
    adminGetSubscription: async () => null,
    adminWorkspaceTokens: async () => 0,
    ...overrides
  };
}
function operatorWith(supabase, extra = {}) {
  const recorded = [];
  const operator = createOperator({ supabase, router, ledger: { record: async (contribution, context) => recorded.push(context.operation) }, syncRevenue: async () => ({ warnings: [] }), billingEnabled: () => false, planRules: PLAN_RULES, assertAiBudget, ...extra });
  return { operator, recorded };
}

test("a cycle skips when the daily operator token cap is spent", async () => {
  const supabase = fakeSupabase({ adminTokensSince: async () => 31000 });
  const { operator } = operatorWith(supabase);
  const run = await operator.startRun({ workspaceId: "w1", trigger: "scheduled" });
  assert.match(run.skip, /Daily operator token cap/);
  assert.equal(supabase.runs[0].status, "skipped");
});

test("a full cycle collects metrics, writes a brief and drafts only safe internal work", async () => {
  const supabase = fakeSupabase();
  const { operator, recorded } = operatorWith(supabase);
  const run = await operator.startRun({ workspaceId: "w1", trigger: "manual" });
  assert.equal(run.skip, null);
  const context = await operator.collect({ workspaceId: "w1" });
  assert.equal(context.metrics.evidence.customerInterviews, 1);
  const { brief, model } = await operator.brief({ workspaceId: "w1", userId: "u1", context });
  assert.equal(model, "Demo engine");
  const internal = brief.recommendedActions.filter(item => item.kind === "internal" && !item.requiresApproval);
  const { drafts } = await operator.draftInternalWork({ workspaceId: "w1", userId: "u1", mode: "autopilot", context, brief });
  assert.equal(drafts.length, Math.min(2, internal.length));
  assert.ok(drafts.every(draft => draft.status === "template"));
  assert.deepEqual((await operator.draftInternalWork({ workspaceId: "w1", mode: "supervised", context, brief })).drafts, []);
  assert.deepEqual(recorded.slice(0, 1), ["operator-brief"]);
});

test("revenue sync runs only when Stripe is connected", async () => {
  let synced = 0;
  const { operator } = operatorWith(fakeSupabase({ getPaymentConnection: async () => ({ mode: "test" }) }), { syncRevenue: async () => { synced++; return { warnings: ["renewals skipped"] }; } });
  const context = await operator.collect({ workspaceId: "w1" });
  assert.equal(synced, 1);
  assert.deepEqual(context.warnings, ["renewals skipped"]);
  assert.equal(context.metrics.revenue.stripeConnected, true);
});

test("scheduled cycles respect pause, plan status and the AI budget", async () => {
  const workspace = { id: "w1", user_id: "u1", state: { operatingMode: { mode: "supervised", paused: false } } };
  assert.equal((await operatorWith(fakeSupabase()).operator.scheduledAccess(workspace)).allowed, true);
  assert.equal((await operatorWith(fakeSupabase()).operator.scheduledAccess({ ...workspace, state: { operatingMode: { mode: "supervised", paused: true } } })).allowed, false);
  const billed = operatorWith(fakeSupabase(), { billingEnabled: () => true }).operator;
  assert.match((await billed.scheduledAccess(workspace)).reason, /active plan/);
  const active = operatorWith(fakeSupabase({ adminGetSubscription: async () => ({ tier: "starter", status: "active" }), adminWorkspaceTokens: async () => 100000 }), { billingEnabled: () => true }).operator;
  assert.match((await active.scheduledAccess(workspace)).reason, /token limit/);
});

test("subscription renewals sync as orders, and a missing permission only warns", async () => {
  const orders = new Map(), connections = new Map();
  const store = { getConnection: async id => connections.get(id), saveConnection: async row => connections.set(row.workspace_id, row), upsertOrders: async rows => rows.forEach(row => orders.set(row.external_id, row)), markSynced: async () => {} };
  let invoicesAllowed = true;
  const stripe = {
    verify: async () => ({ mode: "test" }),
    paidSessions: async () => [{ id: "cs_1", amount_total: 2900, currency: "usd", created: 1761500000, subscription: "sub_1", customer_details: { email: "a@b.test" } }],
    renewalInvoices: async () => { if (!invoicesAllowed) throw Object.assign(new Error("no permission"), { status: 403 }); return [{ id: "in_2", amount_paid: 2900, currency: "usd", customer_email: "a@b.test", status_transitions: { paid_at: 1764100000 }, billing_reason: "subscription_cycle" }]; }
  };
  const engine = createRevenueEngine({ store, stripe, secretBox });
  await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  const offers = [{ id: "o1", checkout: { paymentLinkId: "plink_1" } }];
  const first = await engine.sync({ workspaceId: "w1", offers });
  assert.deepEqual([...orders.keys()], ["cs_1", "in_2"]);
  assert.deepEqual(first.warnings, []);
  invoicesAllowed = false;
  const second = await engine.sync({ workspaceId: "w1", offers });
  assert.match(second.warnings[0], /Invoices: Read/);
});
