// HTTP routes for the Revenue Engine. Every route requires a signed-in founder
// and loads the workspace through RLS, so a founder can only act on their own
// companies. Returns true when it handled the request.
const supabase = require("./supabase");
const router = require("./router");
const secretBox = require("./secret-box");
const { createFounderStripe, REQUIRED_PERMISSIONS, OPTIONAL_PERMISSIONS } = require("./founder-stripe");
const { createRevenueEngine, summarize } = require("./revenue-engine");
const { assertCanGenerate, usageLedger } = require("./ai-access");
const { runInBackground } = require("./background");

const store = {
  getConnection: supabase.getPaymentConnection,
  saveConnection: supabase.savePaymentConnection,
  deleteConnection: supabase.deletePaymentConnection,
  upsertOrders: supabase.upsertOrders,
  markSynced: supabase.markPaymentSynced,
  saveWebhook: supabase.savePaymentWebhook
};
const engine = createRevenueEngine({ store, stripe: createFounderStripe(), secretBox });
const webhookUrl = workspaceId => { const base = String(process.env.APP_URL || "").replace(/\/$/, ""); return base ? `${base}/api/stripe/founder-webhook/${encodeURIComponent(workspaceId)}` : ""; };

// Tries to switch on instant updates; a missing permission or an unapplied
// migration leaves the company on daily/manual sync with an explanation.
async function tryEnableInstantUpdates(workspaceId) {
  try { return await engine.enableInstantUpdates({ workspaceId, webhookUrl: webhookUrl(workspaceId) }); }
  catch (error) {
    const reason = error.status === 403 ? "Add the Webhook Endpoints: Write permission to the restricted key to get instant updates." : error.status === 400 && /column|PGRST204/i.test(error.message) ? "Run the instant-updates SQL update in Supabase first." : String(error.message || "Instant updates could not be enabled").slice(0, 200);
    return { instantUpdates: false, reason };
  }
}

const OFFER_TYPES = ["service", "product", "membership", "digital"], CURRENCIES = ["USD", "CAD", "GBP", "EUR"], BILLING = ["one_time", "monthly", "yearly"];
const offerSchema = {
  type: "object", additionalProperties: false,
  required: ["name", "type", "price", "currency", "billing", "description", "pricingRationale", "unitEconomics", "risks"],
  properties: {
    name: { type: "string", maxLength: 100 }, type: { type: "string", enum: OFFER_TYPES }, price: { type: "number" },
    currency: { type: "string", enum: CURRENCIES }, billing: { type: "string", enum: BILLING },
    description: { type: "string", maxLength: 1000 }, pricingRationale: { type: "string", maxLength: 600 },
    unitEconomics: { type: "object", additionalProperties: false, required: ["estimatedCostPerSale", "estimatedGrossMarginPercent", "salesToFirstGoal", "assumptions"], properties: { estimatedCostPerSale: { type: "number" }, estimatedGrossMarginPercent: { type: "number" }, salesToFirstGoal: { type: "integer" }, assumptions: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 4 } } },
    risks: { type: "array", items: { type: "string", maxLength: 240 }, maxItems: 4 }
  }
};

function templateOffer(context) {
  const plan = context.plan || {}, customer = String(plan.customer || "your target customer");
  return {
    name: `${String(plan.name || "Founding customer")} pilot`.slice(0, 100), type: "service", price: 99, currency: "USD", billing: "one_time",
    description: `A hands-on pilot for ${customer}: ${String(plan.offer || "the core outcome from your plan")}`.slice(0, 1000),
    pricingRationale: "Template price. No model is configured, so this is a placeholder to edit, not a recommendation.",
    unitEconomics: { estimatedCostPerSale: 0, estimatedGrossMarginPercent: 0, salesToFirstGoal: 10, assumptions: ["Template values: replace with your real delivery cost"] },
    risks: ["Willingness to pay has not been validated"]
  };
}

function cleanOffer(draft) {
  const pick = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  return {
    name: String(draft.name || "").slice(0, 100), type: pick(draft.type, OFFER_TYPES, "service"),
    price: Math.max(0.5, Math.round(Number(draft.price || 0) * 100) / 100), currency: pick(draft.currency, CURRENCIES, "USD"), billing: pick(draft.billing, BILLING, "one_time"),
    description: String(draft.description || "").slice(0, 1000), pricingRationale: String(draft.pricingRationale || "").slice(0, 600),
    unitEconomics: draft.unitEconomics || null, risks: Array.isArray(draft.risks) ? draft.risks.slice(0, 4) : []
  };
}

async function handleRevenue({ req, res, pathname, requestUrl, sendJson, readBody, rateLimited }) {
  if (!pathname.startsWith("/api/revenue/")) return false;
  try {
    if (!supabase.configured()) return sendJson(res, 503, { error: "Company revenue requires Supabase" }), true;
    const user = await supabase.verifyUser(req);
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? await supabase.getWorkspace(req, workspaceId) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;
    const saveOffers = offers => supabase.saveWorkspace(req, workspace.id, { ...(workspace.state || {}), offers });

    if (pathname === "/api/revenue/status" && req.method === "GET") return sendJson(res, 200, { ...(await engine.status(workspace.id)), requiredPermissions: REQUIRED_PERMISSIONS.map(([name, level]) => `${name}: ${level}`), optionalPermissions: OPTIONAL_PERMISSIONS.map(([name, level]) => `${name}: ${level}`) }), true;

    if (pathname === "/api/revenue/stripe/connect" && req.method === "POST") {
      if (await rateLimited(req, "stripe-connect", 10)) return sendJson(res, 429, { error: "Too many connection attempts. Try again later." }), true;
      const connected = await engine.connect({ workspaceId: workspace.id, userId: user.id, apiKey: input.apiKey, confirmOwnership: input.confirmOwnership });
      return sendJson(res, 200, { ...connected, ...(await tryEnableInstantUpdates(workspace.id)) }), true;
    }
    if (pathname === "/api/revenue/stripe/webhook" && req.method === "POST") {
      const result = await tryEnableInstantUpdates(workspace.id);
      return sendJson(res, result.instantUpdates ? 200 : 409, result.instantUpdates ? result : { error: result.reason }), true;
    }
    if (pathname === "/api/revenue/stripe/disconnect" && req.method === "POST") return sendJson(res, 200, await engine.disconnect(workspace.id)), true;

    if (pathname === "/api/revenue/offers/checkout" && req.method === "POST") {
      const page = await supabase.getOwnerPage(req, workspace.id), appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
      const successUrl = page?.published && appUrl.startsWith("https://") ? `${appUrl}/p/${encodeURIComponent(page.slug)}?paid=1` : null;
      const result = await engine.createCheckout({ workspace, offerId: String(input.offerId || ""), confirm: input.confirm, successUrl });
      await saveOffers(result.offers);
      return sendJson(res, 200, { offer: result.offer }), true;
    }
    if (pathname === "/api/revenue/offers/active" && req.method === "POST") {
      const result = await engine.setOfferActive({ workspace, offerId: String(input.offerId || ""), active: input.active === true });
      await saveOffers(result.offers);
      return sendJson(res, 200, { offer: result.offer }), true;
    }

    if (pathname === "/api/revenue/sync" && req.method === "POST") {
      if (await rateLimited(req, "revenue-sync", 30)) return sendJson(res, 429, { error: "Revenue was synced recently. Try again shortly." }), true;
      const sync = await engine.sync({ workspaceId: workspace.id, offers: workspace.state?.offers });
      return sendJson(res, 200, { sync }), true;
    }
    if (pathname === "/api/revenue/summary" && req.method === "GET") {
      const [orders, views, status] = await Promise.all([supabase.listOrders(req, workspace.id), supabase.countPageViews(req, workspace.id), engine.status(workspace.id)]);
      return sendJson(res, 200, { summary: summarize(orders, { views }), orders: orders.slice(0, 50), status }), true;
    }

    if (pathname === "/api/revenue/offers/draft" && req.method === "POST") {
      await assertCanGenerate(req, user, workspace.id);
      const state = workspace.state || {};
      const context = { plan: state.plan || null, brief: state.brief || null, evaluation: state.evaluation || null, existingOffers: (state.offers || []).map(offer => ({ name: offer.name, price: offer.price, billing: offer.billing })), founderNotes: String(input.notes || "").slice(0, 600) };
      const { result, contribution, warnings } = await router.generateAgentTask(context, templateOffer, offerSchema, {
        role: "Offer Strategist", schemaName: "offer_draft", tier: "reasoning",
        instructions: "You are Nova.Ai's Offer Strategist. Design one specific, sellable first offer for the company described: what the customer receives, the outcome, price, billing, and why that price fits the customer and the plan. Unit economics are estimates: label assumptions plainly and keep numbers conservative. Prefer a small paid pilot that can be delivered by the founder this month. Never promise results, income, or guarantees you cannot verify, and never invent customer evidence. Return one JSON object matching the schema."
      });
      await usageLedger.record(contribution, { workspaceId: workspace.id, userId: user.id, operation: "offer-draft" });
      return sendJson(res, 200, { draft: cleanOffer(result), contribution, warnings }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Revenue request failed" }), true;
  }
}

async function syncWorkspaceRevenue(workspaceId) {
  const workspace = await supabase.adminGetWorkspace(workspaceId, "id,state");
  return engine.sync({ workspaceId, offers: workspace?.state?.offers });
}

// Daily cron: sync every connected company's Stripe payments.
async function syncAllRevenue() {
  if (!supabase.configured() || !supabase.hasSecret()) return [];
  const results = [];
  for (const { workspace_id: workspaceId } of await supabase.listPaymentConnections()) {
    try {
      const workspace = await supabase.adminGetWorkspace(workspaceId, "id,state");
      results.push({ workspaceId, status: "synced", ...(await engine.sync({ workspaceId, offers: workspace?.state?.offers })) });
    } catch (error) { results.push({ workspaceId, status: "failed", error: String(error.message || "").slice(0, 200) }); }
  }
  return results;
}

// Public endpoint Stripe calls in each founder's account. The signature is
// checked against that company's own secret before anything happens; a
// verified event triggers a background sync and Stripe gets 200 at once.
async function handleFounderWebhook({ req, res, pathname, sendJson, readRawBody, rateLimited }) {
  const match = pathname.match(/^\/api\/stripe\/founder-webhook\/([0-9a-f-]{36})$/i);
  if (!match || req.method !== "POST") return false;
  try {
    if (!supabase.configured() || !supabase.hasSecret()) return sendJson(res, 503, { error: "Not configured" }), true;
    const workspaceId = match[1], rawBody = await readRawBody(req);
    const { event, relevant } = await engine.handleWebhook({ workspaceId, rawBody, signature: req.headers["stripe-signature"] });
    // Bursts of events collapse: past the limit, the daily sync catches up.
    if (relevant && !(await rateLimited(req, `founder-webhook-${workspaceId}`, 120, 3_600_000, workspaceId))) runInBackground(syncWorkspaceRevenue(workspaceId), "Stripe webhook sync");
    return sendJson(res, 200, { received: true, type: event.type }), true;
  } catch (error) {
    return sendJson(res, error.status || 400, { error: error.status === 404 ? "Unknown endpoint" : "Webhook rejected" }), true;
  }
}

module.exports = { handleRevenue, handleFounderWebhook, syncAllRevenue, syncWorkspaceRevenue, cleanOffer, templateOffer, offerSchema };
