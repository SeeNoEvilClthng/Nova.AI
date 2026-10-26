// Growth routes: source attribution summary, AI-drafted lead follow-up,
// founder-approved sending, and the public unsubscribe page.
const crypto = require("node:crypto");
const supabase = require("./supabase");
const router = require("./router");
const { summarizeBySource } = require("./attribution");
const { publicOffers } = require("./revenue-engine");
const outreach = require("./email-outreach");
const { assertCanGenerate, usageLedger } = require("./ai-access");

const draftSchema = { type: "object", additionalProperties: false, required: ["subject", "body"], properties: { subject: { type: "string", maxLength: 150 }, body: { type: "string", maxLength: 3000 } } };
const appUrl = () => String(process.env.APP_URL || "").replace(/\/$/, "");
const escape = value => String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const unsubscribePage = (title, body, form = "") => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1424;color:#fff;font-family:system-ui,sans-serif;padding:24px}main{max-width:460px;text-align:center}p{color:#bbc2d3;line-height:1.6}button{border:0;border-radius:10px;background:#7668ef;color:#fff;padding:14px 20px;font-weight:700;cursor:pointer}</style></head><body><main><h1>${escape(title)}</h1><p>${escape(body)}</p>${form}</main></body></html>`;

async function handleGrowth({ req, res, pathname, requestUrl, sendJson, readBody, rateLimited }) {
  // Public unsubscribe: GET shows a confirm button (so link scanners can't
  // unsubscribe people), POST unsubscribes (also used by one-click mail apps).
  const unsubscribe = pathname.match(/^\/u\/([A-Za-z0-9_.-]{10,200})$/);
  if (unsubscribe) {
    const html = (status, page) => { res.writeHead(status, { "Content-Type": "text/html", "Cache-Control": "no-store" }); res.end(page); return true; };
    const leadId = outreach.verifyUnsubscribeToken(unsubscribe[1]);
    if (!leadId) return html(400, unsubscribePage("Link not valid", "This unsubscribe link is incomplete or has been changed."));
    if (req.method === "GET") return html(200, unsubscribePage("Unsubscribe?", "You'll stop receiving follow-up emails from this company.", `<form method="post"><button>Unsubscribe</button></form>`));
    if (req.method === "POST") {
      try { await supabase.unsubscribeLead(leadId); return html(200, unsubscribePage("You're unsubscribed", "You won't receive further follow-up emails from this company.")); }
      catch { return html(500, unsubscribePage("Something went wrong", "Please try again in a moment.")); }
    }
    return false;
  }
  if (!pathname.startsWith("/api/growth/")) return false;
  try {
    if (!supabase.configured()) return sendJson(res, 503, { error: "Growth tools require Supabase" }), true;
    const user = await supabase.verifyUser(req);
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? await supabase.getWorkspace(req, workspaceId) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;
    const page = await supabase.getOwnerPage(req, workspace.id);
    const pageUrl = page?.published && appUrl() ? `${appUrl()}/p/${page.slug}` : null;
    const company = String(workspace.state?.plan?.name || workspace.name || "our company");

    if (pathname === "/api/growth/summary" && req.method === "GET") {
      const email = { configured: Boolean(outreach.emailConfig()), maxPerBatch: outreach.MAX_PER_BATCH, maxPerDay: outreach.MAX_PER_DAY };
      if (!page) return sendJson(res, 200, { published: false, sources: [], leads: { new: 0, contacted: 0, unsubscribed: 0 }, email }), true;
      try {
        const [events, leads, orders] = await Promise.all([supabase.listPageEventsForGrowth(req, page.id), supabase.listLeadsForGrowth(req, page.id), supabase.listOrdersForGrowth(req, workspace.id).catch(() => [])]);
        const reachable = leads.filter(lead => !lead.unsubscribed_at);
        return sendJson(res, 200, { published: Boolean(page.published), pageUrl, sources: summarizeBySource({ events, leads, orders }), leads: { new: reachable.filter(lead => lead.status === "new").length, contacted: leads.filter(lead => lead.last_contacted_at).length, unsubscribed: leads.length - reachable.length }, email }), true;
      } catch (error) {
        if (error.status === 400) return sendJson(res, 200, { published: Boolean(page.published), migrationNeeded: true, sources: [], leads: { new: 0, contacted: 0, unsubscribed: 0 }, email }), true;
        throw error;
      }
    }

    if (pathname === "/api/growth/followup/draft" && req.method === "POST") {
      await assertCanGenerate(req, user, workspace.id);
      const offer = publicOffers(workspace.state?.offers)[0] || null;
      const context = { company, plan: workspace.state?.plan || null, liveOffer: offer, pageUrl, founderNotes: String(input.notes || "").slice(0, 600) };
      const { result, contribution, warnings } = await router.generateAgentTask(context, () => outreach.templateFollowUp({ company, offer, pageUrl }), draftSchema, {
        role: "Sales Agent", schemaName: "lead_followup", tier: "fast",
        instructions: "You are Nova.Ai's Sales Agent. Write one short, personal, plain-text follow-up email to people who signed up for updates on this company's launch page. Thank them, ask one specific question about their situation, and if a live offer is provided, mention it once with its link. Be honest: no invented scarcity, discounts, testimonials, results or guarantees, and no claims the company cannot back up. Under 150 words. Do not add an unsubscribe line; it is added automatically. Return one JSON object with subject and body."
      });
      await usageLedger.record(contribution, { workspaceId: workspace.id, userId: user.id, operation: "lead-followup-draft" });
      return sendJson(res, 200, { draft: outreach.cleanDraft(result), templated: contribution.model === "Demo engine", warnings }), true;
    }

    if (pathname === "/api/growth/followup/send" && req.method === "POST") {
      if (await rateLimited(req, "lead-followup-send", 10)) return sendJson(res, 429, { error: "Too many sends this hour" }), true;
      if (input.confirm !== true) return sendJson(res, 400, { error: "Confirm the exact message and recipients before sending" }), true;
      const config = outreach.emailConfig();
      if (!config) return sendJson(res, 503, { error: "Email sending isn't set up yet. Add RESEND_API_KEY and NOVA_EMAIL_FROM in Vercel, or copy the draft and send it yourself." }), true;
      if (!page) return sendJson(res, 409, { error: "Publish a launch page to collect leads first" }), true;
      const draft = outreach.cleanDraft(input), leads = await supabase.adminOutreachLeads(page.id);
      if (!leads.length) return sendJson(res, 409, { error: "There are no new, subscribed leads to email" }), true;
      const sentToday = await supabase.adminCountEmailSendsSince(workspace.id, new Date(Date.now() - 86400000).toISOString());
      const batchId = crypto.randomUUID();
      const { results, skippedForLimits } = await outreach.sendBatch({ leads, draft, company, pageUrl, appUrl: appUrl(), replyTo: user.email, sentToday, batchId, send: (message, replyTo, key) => outreach.sendViaResend({ config, message, replyTo, idempotencyKey: key }) });
      if (results.length) await supabase.insertEmailSends(results.map(item => ({ workspace_id: workspace.id, lead_id: item.lead.id, batch_id: batchId, email: item.lead.email, subject: draft.subject, status: item.status, provider_id: item.providerId || null, error: item.error || null })));
      await supabase.markLeadsContacted(results.filter(item => item.status === "sent").map(item => item.lead.id));
      const sent = results.filter(item => item.status === "sent").length;
      return sendJson(res, 200, { sent, failed: results.length - sent, skippedForLimits, remainingToday: Math.max(0, outreach.MAX_PER_DAY - sentToday - results.length) }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Growth request failed" }), true;
  }
}

module.exports = { handleGrowth };
