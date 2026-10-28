// Action Center routes, executors and the operator's action proposer.
const supabase = require("./supabase");
const outreach = require("./email-outreach");
const { createActionEngine, publicAction } = require("./actions");
const { runInBackground } = require("./background");

const store = { insert: row => supabase.insertAction(row), findOpen: (workspaceId, key) => supabase.findOpenAction(workspaceId, key), transition: (id, from, values) => supabase.transitionAction(id, from, values) };

// Each executor performs the approved action with the same code the founder
// would trigger by hand, and returns the provider's own IDs as evidence.
const executors = {
  async lead_followup(action) {
    const result = await require("./growth-routes").sendFollowUp({ workspaceId: action.workspace_id, draft: action.payload, replyTo: action.approver_email });
    if (!result.sent && result.failed) throw new Error(`All ${result.failed} emails were rejected by the email provider`);
    return { provider: "resend", sent: result.sent, failed: result.failed, heldForDailyLimit: result.skippedForLimits, batchId: result.batchId, messageIds: result.providerIds };
  },
  async offer_go_live(action) {
    const offer = await require("./revenue-routes").goLiveOffer({ workspaceId: action.workspace_id, offerId: action.payload.offerId });
    return { provider: "stripe", mode: offer.checkout.mode, paymentLinkId: offer.checkout.paymentLinkId, productId: offer.checkout.productId, priceId: offer.checkout.priceId, url: offer.checkout.url };
  }
};

const engine = createActionEngine({ store, executors });

// Called at the end of each operator cycle. Turns the company's real state
// into specific, ready-to-run proposals; nothing runs until approved.
async function proposeOperatorActions({ workspaceId, userId, metrics }) {
  let created = 0;
  const workspace = await supabase.adminGetWorkspace(workspaceId, "id,name,state");
  if (!workspace) return { created };
  if (metrics?.funnel?.newLeads > 0 && outreach.emailConfig()) {
    const page = await supabase.adminGetOwnerPage(workspaceId), appUrl = String(process.env.APP_URL || "").replace(/\/$/, "");
    const pageUrl = page?.published && appUrl ? `${appUrl}/p/${page.slug}` : null;
    const existing = await supabase.findOpenAction(workspaceId, "lead_followup");
    if (!existing) {
      const { draft } = await require("./growth-routes").draftFollowUp({ workspace, pageUrl, userId });
      const count = metrics.funnel.newLeads;
      const result = await engine.propose({ workspaceId, kind: "lead_followup", title: `Email ${count} new lead${count === 1 ? "" : "s"}`, summary: "They signed up on your launch page and haven't been contacted. Review the draft, then approve to send.", payload: { ...draft, leadCount: count }, dedupeKey: "lead_followup" });
      if (result.created) created++;
    }
  }
  if (metrics?.revenue?.stripeConnected) {
    const offers = (workspace.state?.offers || []).filter(offer => !offer.checkout && offer.status !== "paused" && Number(offer.price) >= 0.5).slice(0, 2);
    for (const offer of offers) {
      const result = await engine.propose({ workspaceId, kind: "offer_go_live", title: `Take “${String(offer.name).slice(0, 80)}” live`, summary: "Creates the product, price and a public checkout link in this company's Stripe account so customers can pay.", payload: { offerId: offer.id, name: offer.name, price: offer.price, currency: offer.currency, billing: offer.billing }, dedupeKey: `offer_go_live:${offer.id}` });
      if (result.created) created++;
    }
  }
  return { created };
}

async function handleActions({ req, res, pathname, requestUrl, sendJson, readBody }) {
  if (!pathname.startsWith("/api/actions")) return false;
  try {
    if (!supabase.configured()) return sendJson(res, 503, { error: "The Action Center requires Supabase" }), true;
    const user = await supabase.verifyUser(req);
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? await supabase.getWorkspace(req, workspaceId) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;

    if (pathname === "/api/actions" && req.method === "GET") {
      const actions = await supabase.listActions(req, workspace.id);
      return sendJson(res, 200, { actions: actions.map(action => publicAction(action)) }), true;
    }
    const match = pathname.match(/^\/api\/actions\/([0-9a-f-]{36})\/(decision|retry)$/i);
    if (match && req.method === "POST") {
      const action = await supabase.getAction(req, workspace.id, match[1]);
      if (!action) return sendJson(res, 404, { error: "Action not found" }), true;
      const updated = match[2] === "decision" ? await engine.decide({ action, approved: input.approved === true, approverEmail: user.email }) : await engine.retry(action);
      if (updated.status === "approved") runInBackground(engine.execute(updated.id), "Action");
      return sendJson(res, 200, { action: publicAction(updated) }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Action request failed" }), true;
  }
}

module.exports = { handleActions, proposeOperatorActions, executors };
