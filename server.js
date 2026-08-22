const express = require("express");
const fs = require("fs");
const path = require("path");
const router = require("./router");
const database = require("./database");
const supabase = require("./supabase");
const billing = require("./billing");
const { assertAiBudget } = require("./ai-budget");
const entitlements = require("./entitlements");
const execution = require("./execution-core");
const toolPermissions = require("./tool-permissions");
const crypto = require("node:crypto");

const port = Number(process.env.PORT || 4180);
const receiptSecret=()=>{
  const secret=process.env.EXECUTION_RECEIPT_SECRET||process.env.SUPABASE_SECRET_KEY;
  if(secret)return secret;
  if(process.env.NODE_ENV==="production")throw Object.assign(new Error("EXECUTION_RECEIPT_SECRET is required in production"),{status:503});
  return "nova-local-development-receipt-key";
};
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const staticFiles = new Map([
  ["/", ["index.html", fs.readFileSync(path.join(__dirname, "index.html"))]],
  ["/welcome", ["welcome.html", fs.readFileSync(path.join(__dirname, "welcome.html"))]],
  ["/reseller", ["reseller.html", fs.readFileSync(path.join(__dirname, "reseller.html"))]],
  ["/reseller-studio", ["reseller-app.html", fs.readFileSync(path.join(__dirname, "reseller-app.html"))]],
  ["/privacy", ["privacy.html", fs.readFileSync(path.join(__dirname, "privacy.html"))]],
  ["/terms", ["terms.html", fs.readFileSync(path.join(__dirname, "terms.html"))]],
  ["/billing-policy", ["billing-policy.html", fs.readFileSync(path.join(__dirname, "billing-policy.html"))]],
  ["/nova-mark.png", ["nova-mark.png", fs.readFileSync(path.join(__dirname, "nova-mark.png"))]],
  ["/og-nova.png", ["og-nova.png", fs.readFileSync(path.join(__dirname, "og-nova.png"))]],
  ["/social/baccarat-rouge-540-xayresell-v3.png", ["baccarat-rouge-540-xayresell-v3.png", fs.readFileSync(path.join(__dirname, "public/social/baccarat-rouge-540-xayresell-v3.png"))]],
  ["/index.html", ["index.html", fs.readFileSync(path.join(__dirname, "index.html"))]],
  ["/styles.css", ["styles.css", fs.readFileSync(path.join(__dirname, "styles.css"))]],
  ["/router.css", ["router.css", fs.readFileSync(path.join(__dirname, "router.css"))]],
  ["/workspaces.css", ["workspaces.css", fs.readFileSync(path.join(__dirname, "workspaces.css"))]],
  ["/auth.css", ["auth.css", fs.readFileSync(path.join(__dirname, "auth.css"))]],
  ["/billing.css", ["billing.css", fs.readFileSync(path.join(__dirname, "billing.css"))]],
  ["/revision.css", ["revision.css", fs.readFileSync(path.join(__dirname, "revision.css"))]],
  ["/workspace-actions.css", ["workspace-actions.css", fs.readFileSync(path.join(__dirname, "workspace-actions.css"))]],
  ["/onboarding.css", ["onboarding.css", fs.readFileSync(path.join(__dirname, "onboarding.css"))]],
  ["/product-tools.css", ["product-tools.css", fs.readFileSync(path.join(__dirname, "product-tools.css"))]],
  ["/lead-inbox.css", ["lead-inbox.css", fs.readFileSync(path.join(__dirname, "lead-inbox.css"))]],
  ["/modern.css", ["modern.css", fs.readFileSync(path.join(__dirname, "modern.css"))]],
  ["/workforce.css", ["workforce.css", fs.readFileSync(path.join(__dirname, "workforce.css"))]],
  ["/ai-office.css", ["ai-office.css", fs.readFileSync(path.join(__dirname, "ai-office.css"))]],
  ["/ai-activity.css", ["ai-activity.css", fs.readFileSync(path.join(__dirname, "ai-activity.css"))]],
  ["/command-menu.css", ["command-menu.css", fs.readFileSync(path.join(__dirname, "command-menu.css"))]],
  ["/notifications.css", ["notifications.css", fs.readFileSync(path.join(__dirname, "notifications.css"))]],
  ["/settings.css", ["settings.css", fs.readFileSync(path.join(__dirname, "settings.css"))]],
  ["/founder-focus.css", ["founder-focus.css", fs.readFileSync(path.join(__dirname, "founder-focus.css"))]],
  ["/founder-focus-theme.css", ["founder-focus-theme.css", fs.readFileSync(path.join(__dirname, "founder-focus-theme.css"))]],
  ["/company-memory.css", ["company-memory.css", fs.readFileSync(path.join(__dirname, "company-memory.css"))]],
  ["/company-memory-theme.css", ["company-memory-theme.css", fs.readFileSync(path.join(__dirname, "company-memory-theme.css"))]],
  ["/operating-rhythm.css", ["operating-rhythm.css", fs.readFileSync(path.join(__dirname, "operating-rhythm.css"))]],
  ["/goals-metrics.css", ["goals-metrics.css", fs.readFileSync(path.join(__dirname, "goals-metrics.css"))]],
  ["/goals-metrics-live.css", ["goals-metrics-live.css", fs.readFileSync(path.join(__dirname, "goals-metrics-live.css"))]],
  ["/revenue.css", ["revenue.css", fs.readFileSync(path.join(__dirname, "revenue.css"))]],
  ["/execution-engine.css", ["execution-engine.css", fs.readFileSync(path.join(__dirname, "execution-engine.css"))]],
  ["/minimal-ui.css", ["minimal-ui.css", fs.readFileSync(path.join(__dirname, "minimal-ui.css"))]],
  ["/durable-missions.css", ["durable-missions.css", fs.readFileSync(path.join(__dirname, "durable-missions.css"))]],
  ["/connections.css", ["connections.css", fs.readFileSync(path.join(__dirname, "connections.css"))]],
  ["/public-site.css", ["public-site.css", fs.readFileSync(path.join(__dirname, "public-site.css"))]],
  ["/world-gateway.css", ["world-gateway.css", fs.readFileSync(path.join(__dirname, "world-gateway.css"))]],
  ["/world-gateway.js", ["world-gateway.js", fs.readFileSync(path.join(__dirname, "world-gateway.js"))]],
  ["/reseller-app.css", ["reseller-app.css", fs.readFileSync(path.join(__dirname, "reseller-app.css"))]],
  ["/reseller-ai.css", ["reseller-ai.css", fs.readFileSync(path.join(__dirname, "reseller-ai.css"))]],
  ["/reseller-content.css", ["reseller-content.css", fs.readFileSync(path.join(__dirname, "reseller-content.css"))]],
  ["/reseller-content-mobile.css", ["reseller-content-mobile.css", fs.readFileSync(path.join(__dirname, "reseller-content-mobile.css"))]],
  ["/reseller-interactions.css", ["reseller-interactions.css", fs.readFileSync(path.join(__dirname, "reseller-interactions.css"))]],
  ["/reseller-app.js", ["reseller-app.js", fs.readFileSync(path.join(__dirname, "reseller-app.js"))]],
  ["/launch-studio.css", ["launch-studio.css", fs.readFileSync(path.join(__dirname, "launch-studio.css"))]],
  ["/validation.css", ["validation.css", fs.readFileSync(path.join(__dirname, "validation.css"))]],
  ["/auth.js", ["auth.js", fs.readFileSync(path.join(__dirname, "auth.js"))]],
  ["/app.js", ["app.js", fs.readFileSync(path.join(__dirname, "app.js"))]],
  ["/billing-client.js", ["billing-client.js", fs.readFileSync(path.join(__dirname, "billing-client.js"))]],
  ["/validation.js", ["validation.js", fs.readFileSync(path.join(__dirname, "validation.js"))]],
  ["/live-kpis.js", ["live-kpis.js", fs.readFileSync(path.join(__dirname, "live-kpis.js"))]],
  ["/revenue.js", ["revenue.js", fs.readFileSync(path.join(__dirname, "revenue.js"))]],
  ["/execution-engine.js", ["execution-engine.js", fs.readFileSync(path.join(__dirname, "execution-engine.js"))]],
  ["/minimal-ui.js", ["minimal-ui.js", fs.readFileSync(path.join(__dirname, "minimal-ui.js"))]],
  ["/durable-missions.js", ["durable-missions.js", fs.readFileSync(path.join(__dirname, "durable-missions.js"))]],
  ["/connections.js", ["connections.js", fs.readFileSync(path.join(__dirname, "connections.js"))]]
]);
const rateBuckets = new Map();

function clientIp(req) { return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim(); }
function rateLimited(req, scope, limit, windowMs = 3_600_000) {
  const key = `${scope}:${clientIp(req)}`, now = Date.now(), recent = (rateBuckets.get(key) || []).filter(time => now - time < windowMs);
  if (recent.length >= limit) return true;
  recent.push(now); rateBuckets.set(key, recent); return false;
}

function productionReady() {
  const missing = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "APP_URL"].filter(key => !process.env[key]);
  if (process.env.NODE_ENV === "production" && missing.length) throw new Error(`Missing production environment: ${missing.join(", ")}`);
  if (process.env.NODE_ENV === "production" && !String(process.env.APP_URL).startsWith("https://")) throw new Error("APP_URL must use HTTPS in production");
}
productionReady();

function instagramConfig() {
  const graphVersion = String(process.env.META_GRAPH_VERSION || "v26.0").trim();
  const accessToken = String(process.env.INSTAGRAM_ACCESS_TOKEN || "").trim();
  if (!accessToken || !/^v\d+\.\d+$/.test(graphVersion)) return null;
  return {
    graphVersion,
    accessToken,
    accountId: String(process.env.META_INSTAGRAM_USER_ID || "").trim(),
    username: String(process.env.META_INSTAGRAM_USERNAME || "").trim().replace(/^@/, "").toLowerCase()
  };
}

async function publishInstagram(campaign) {
  const config = instagramConfig();
  if (!config) throw Object.assign(new Error("Add the Instagram access token to Vercel before publishing"), { status: 503 });
  if (!/^https:\/\//.test(String(campaign.mediaUrl || ""))) throw Object.assign(new Error("Approve this content again to prepare its public graphic"), { status: 409 });
  const base = `https://graph.instagram.com/${config.graphVersion}`, headers = { Authorization: `Bearer ${config.accessToken}` };
  const identityResponse = await fetch(`${base}/me?fields=user_id,username`, { headers }), identity = await identityResponse.json();
  if (!identityResponse.ok) throw new Error(identity?.error?.message || "Instagram rejected the saved access token");
  const accountId = String(config.accountId || identity.user_id || identity.id || "");
  if (!accountId) throw new Error("Instagram did not return a professional account ID");
  if (config.username && String(identity.username || "").toLowerCase() !== config.username) throw new Error(`The saved Instagram token belongs to @${identity.username || "another account"}, not @${config.username}`);
  const createBody = new URLSearchParams({ image_url: campaign.mediaUrl, caption: String(campaign.caption || "").slice(0, 2200), is_ai_generated: "true" });
  const createResponse = await fetch(`${base}/${accountId}/media`, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: createBody }), created = await createResponse.json();
  if (!createResponse.ok || !created.id) throw new Error(created?.error?.message || "Instagram could not prepare the approved post");
  const publishResponse = await fetch(`${base}/${accountId}/media_publish`, { method: "POST", headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: String(created.id) }) }), published = await publishResponse.json();
  if (!publishResponse.ok) throw new Error(published?.error?.message || "Instagram rejected the approved post");
  return String(published.id || "");
}

async function verifyInstagramConnection() {
  const config = instagramConfig();
  if (!config) return { configured: false, publishing: false, reason: "Add the Instagram professional account token" };
  try {
    const response = await fetch(`https://graph.instagram.com/${config.graphVersion}/me?fields=user_id,username`, { headers: { Authorization: `Bearer ${config.accessToken}` } }), identity = await response.json();
    if (!response.ok) return { configured: true, publishing: false, reason: identity?.error?.message || "Instagram rejected the saved token" };
    const username = String(identity.username || "").toLowerCase();
    if (config.username && username !== config.username) return { configured: true, publishing: false, reason: `Token belongs to @${username || "another account"}, not @${config.username}` };
    return { configured: true, publishing: true, accountLabel: username ? `Connected as @${username}` : "Connected professional account", accountId: String(identity.user_id || identity.id || "") };
  } catch {
    return { configured: true, publishing: false, reason: "Instagram could not be reached. Try the readiness check again." };
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", chunk => { size += chunk.length; if (size > 1_000_000) return reject(new Error("Request too large")); chunks.push(chunk); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function subscriptionRecord(subscription, fallback = {}) {
  const userId = subscription.metadata?.supabase_user_id || fallback.user_id;
  if (!userId) throw new Error("Stripe subscription is missing its Nova.Ai user ID");
  const priceId = subscription.items?.data?.[0]?.price?.id || fallback.stripe_price_id || null;
  const tier = subscription.metadata?.nova_plan || Object.entries(billing.plans()).find(([, id]) => id === priceId)?.[0] || fallback.tier || null;
  return {
    user_id: userId,
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: priceId,
    tier,
    status: subscription.status,
    current_period_end: billing.subscriptionPeriodEnd(subscription) ? new Date(billing.subscriptionPeriodEnd(subscription) * 1000).toISOString() : null,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
    updated_at: new Date().toISOString()
  };
}
function escapeHtml(value) { return String(value || "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char])); }
function publicPageHtml(page) {
  const s=page.snapshot||{};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(s.subhead)}"><style>*{box-sizing:border-box}body{margin:0;background:#0e1424;color:#fff;font-family:Inter,system-ui,sans-serif}nav{height:76px;display:flex;align-items:center;justify-content:space-between;max-width:1120px;margin:auto;padding:0 24px;border-bottom:1px solid #ffffff18}nav b{font-size:20px}nav span{color:#aeb5c7;font-size:13px}.hero{text-align:center;padding:110px 24px 85px;background:radial-gradient(circle at 75% 0,#6558e855,transparent 35%)}small{color:#a69cff;letter-spacing:.14em;text-transform:uppercase;font-weight:800}h1{font-size:clamp(42px,7vw,76px);line-height:1.05;max-width:980px;margin:25px auto}p{color:#bbc2d3;line-height:1.7;max-width:700px;margin:0 auto 34px;font-size:18px}form{display:flex;max-width:520px;margin:auto;gap:10px}input{flex:1;padding:16px;border:1px solid #ffffff30;border-radius:10px;background:#ffffff0d;color:#fff;font-size:15px}button{border:0;border-radius:10px;background:#7668ef;color:#fff;padding:16px 21px;font-weight:800;cursor:pointer}.trust{display:block;color:#8fdcc4;margin-top:18px;font-size:12px}.proof{display:grid;grid-template-columns:repeat(3,1fr);max-width:900px;margin:0 auto 60px;border:1px solid #ffffff15}.proof span{text-align:center;padding:26px;color:#aeb5c7;border-right:1px solid #ffffff15}.proof span:last-child{border:0}#message{min-height:24px;margin-top:14px;color:#8fdcc4}@media(max-width:620px){form{flex-direction:column}.proof{grid-template-columns:1fr}.proof span{border-right:0;border-bottom:1px solid #ffffff15}}</style></head><body><nav><b>${escapeHtml(page.title)}</b><span>Product · About · Contact</span></nav><main class="hero"><small>${escapeHtml(s.eyebrow)}</small><h1>${escapeHtml(s.headline)}</h1><p>${escapeHtml(s.subhead)}</p><form id="waitlist"><input id="email" type="email" required maxlength="254" placeholder="you@example.com" aria-label="Email address"><button>${escapeHtml(s.cta||"Join waitlist")} →</button></form><div id="message"></div><span class="trust">✓ ${escapeHtml(s.trust)}</span></main><div class="proof"><span>Clear outcome</span><span>Human supervised</span><span>Built to validate</span></div><script>fetch('/api/public/${encodeURIComponent(page.slug)}/view',{method:'POST'});document.getElementById('waitlist').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;const r=await fetch('/api/public/${encodeURIComponent(page.slug)}/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value})});const d=await r.json();document.getElementById('message').textContent=r.ok?'You’re on the early-access list.':(d.error||'Please try again.');if(r.ok)e.target.reset();b.disabled=false};</script></body></html>`;
}

function fallbackPlan({ idea, customer, revenue, goal, feedback, currentPlan }) {
  if (currentPlan && feedback) {
    const focus = feedback.trim();
    const plan = { ...currentPlan, customer: customer || currentPlan.customer, revenue: revenue || currentPlan.revenue, goal: goal || currentPlan.goal };
    if (/price|pricing|revenue|charge|subscription|cost/i.test(focus)) plan.revenue = `${plan.revenue}. Pricing revision to validate: ${focus}`;
    else if (/milestone|timeline|launch|deadline|week|month|day/i.test(focus)) plan.milestone = focus;
    else if (/customer|audience|market|niche|user/i.test(focus)) plan.customer = `${plan.customer} — refined focus: ${focus}`;
    else plan.offer = `${plan.offer} Revision priority: ${focus}`;
    plan.review = `Founder revision applied: ${focus} The next review should verify this change with customer evidence before approval.`;
    return plan;
  }
  const words = idea.split(/\s+/).filter(word => word.length > 3);
  const name = (words.slice(0, 2).join(" ") || "New Venture").replace(/\b\w/g, letter => letter.toUpperCase());
  return {
    name,
    customer,
    offer: `A focused solution that helps ${customer.toLowerCase()} accomplish the core promise in: ${idea}`,
    revenue,
    milestone: "Interview 10 target customers, recruit 3 design partners, then ship one measurable workflow.",
    positioning: `The supervised, outcome-focused option for ${customer.toLowerCase()}—with transparent decisions and human control.`,
    review: "The customer is clear, but willingness to pay is unproven. Validate the urgent problem and pricing before expanding the feature set.",
    goal
  };
}

async function generateWithOpenAI(input) {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["name", "customer", "offer", "revenue", "milestone", "positioning", "review", "goal"],
    properties: Object.fromEntries(["name", "customer", "offer", "revenue", "milestone", "positioning", "review", "goal"].map(key => [key, { type: "string" }]))
  };
  return router.generate(input, fallbackPlan, schema);
}

function fallbackWorkforce(input) {
  const company = input.company || "the company", goal = input.goal, revision = input.context?.revision;
  return {
    summary: revision ? `The Nova.Ai workforce revised “${goal}” using the founder’s feedback: ${String(revision.founderFeedback||"").slice(0,240)}` : `The Nova.Ai workforce divided “${goal}” into a supervised execution plan for ${company}.`,
    needsApproval: true,
    employees: [
      { role:"Strategy Employee",department:"Strategy",status:"completed",deliverable:`Define the smallest measurable version of the objective and a 14-day scorecard. Keep every activity tied to: ${goal}` ,handoff:"Research validates the riskiest assumption before execution."},
      { role:"Research Employee",department:"Research",status:"completed",deliverable:"Interview five target customers, document their current alternative, urgency, decision process, and willingness to pay. Separate observed evidence from assumptions.",handoff:"Product uses repeated problems—not founder guesses—to set scope."},
      { role:"Product Employee",department:"Product",status:"completed",deliverable:"Turn the strongest validated problem into one testable customer workflow. Define acceptance criteria, exclusions, and the smallest launchable version.",handoff:"Marketing receives one clear outcome and proof point."},
      { role:"Growth Employee",department:"Marketing & sales",status:"completed",deliverable:"Draft a focused offer, a five-message outreach sequence, and a list of twenty qualified prospects. Do not send anything until the founder approves it.",handoff:"Operations tracks replies, meetings, and conversions."},
      { role:"Operations Employee",department:"Operations",status:"completed",deliverable:"Create a daily operating rhythm with owners, deadlines, success metrics, blockers, and an end-of-week decision: continue, revise, or stop.",handoff:"Founder reviews all external communication and spending."}
    ]
  };
}

function fallbackWorkforceReview(run) {
  const employees = Array.isArray(run?.employees) ? run.employees : [];
  const completeHandoffs = employees.filter(employee => String(employee.handoff || "").length >= 20).length;
  const ready = employees.length >= 3 && completeHandoffs === employees.length;
  return {
    score: ready ? 82 : 64,
    verdict: ready ? "Ready for founder review" : "Needs a stronger operating handoff",
    ready,
    strengths: ["Work is divided into named specialist responsibilities", "External actions remain behind founder approval"],
    blockers: ready ? [] : ["Add a concrete handoff and measurable outcome for every employee"],
    recommendation: ready ? "Review the proposed actions and approve only the steps you want the team to execute." : "Revise the weakest handoff before approving this run."
  };
}

async function runWorkforce(input) {
  const schema = {
    type:"object",additionalProperties:false,required:["summary","needsApproval","employees"],
    properties:{
      summary:{type:"string"},needsApproval:{type:"boolean"},
      employees:{type:"array",items:{type:"object",additionalProperties:false,required:["role","department","status","deliverable","handoff"],properties:{role:{type:"string"},department:{type:"string"},status:{type:"string",enum:["completed"]},deliverable:{type:"string"},handoff:{type:"string"}}}}
    }
  };
  const reviewSchema = {
    type:"object",additionalProperties:false,required:["score","verdict","ready","strengths","blockers","recommendation"],
    properties:{
      score:{type:"integer",minimum:0,maximum:100},verdict:{type:"string"},ready:{type:"boolean"},
      strengths:{type:"array",items:{type:"string"},maxItems:4},blockers:{type:"array",items:{type:"string"},maxItems:4},recommendation:{type:"string"}
    }
  };
  return router.generateWorkforce(input, fallbackWorkforce, schema, { schema:reviewSchema, fallback:fallbackWorkforceReview });
}

async function enforceAiBudget(req, workspaceId, planCeiling) {
  const id=String(workspaceId||"").trim();
  if(!id)throw Object.assign(new Error("Workspace is required for AI generation"),{status:400});
  const workspace=supabase.configured()?await supabase.getWorkspace(req,id):database.getWorkspace(id);
  if(!workspace)throw Object.assign(new Error("Workspace not found"),{status:404});
  assertAiBudget(workspace.state,planCeiling);
}

async function accountEntitlement(req,user) {
  if(!supabase.configured())return entitlements.resolveEntitlement({billingEnabled:false});
  const subscription=await supabase.getSubscription(req);
  return entitlements.resolveEntitlement({billingEnabled:billing.status().enabled,subscription,user});
}

const app = express();
app.disable("x-powered-by");
app.use(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-Frame-Options", "DENY");
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  if (pathname === "/api/health" && req.method === "GET") return sendJson(res, 200, { status:"ok", service:"Nova.Ai", storage:supabase.configured()?"supabase":"sqlite" });
  if (pathname.startsWith("/p/") && req.method === "GET") {
    try { const page=await supabase.getPublishedPage(decodeURIComponent(pathname.slice(3))); return page ? (res.writeHead(200,{"Content-Type":"text/html","Cache-Control":"no-store"}),res.end(publicPageHtml(page))) : res.writeHead(404).end("Page not found"); }
    catch { return res.writeHead(404).end("Page not found"); }
  }
  if (pathname.match(/^\/api\/public\/[^/]+\/view$/) && req.method === "POST") {
    try { if(rateLimited(req,"page-view",120))return sendJson(res,429,{error:"Too many requests"});const slug=decodeURIComponent(pathname.split("/")[3]),page=await supabase.getPublishedPage(slug);if(!page)return sendJson(res,404,{error:"Page not found"});await supabase.recordPageEvent(page.id,"view");return sendJson(res,201,{recorded:true}); } catch(error){return sendJson(res,error.status||500,{error:error.message});}
  }
  if (pathname.match(/^\/api\/public\/[^/]+\/lead$/) && req.method === "POST") {
    try { if(rateLimited(req,"waitlist",10))return sendJson(res,429,{error:"Too many signup attempts"});const slug=decodeURIComponent(pathname.split("/")[3]),page=await supabase.getPublishedPage(slug),input=await readBody(req),email=String(input.email||"").trim().toLowerCase();if(!page)return sendJson(res,404,{error:"Page not found"});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return sendJson(res,400,{error:"Enter a valid email"});await supabase.captureLead(page.id,email);await supabase.recordPageEvent(page.id,"signup");return sendJson(res,201,{joined:true}); } catch(error){return sendJson(res,error.status===409?200:error.status||500,{error:error.message});}
  }
  if (pathname === "/api/publishing" && req.method === "GET") {
    try { const workspace=requestUrl.searchParams.get("workspace");const page=await supabase.getOwnerPage(req,workspace);const stats=page?await supabase.getPageStats(req,page.id):{views:0,signups:0,leads:[]};return sendJson(res,200,{page,stats}); } catch(error){return sendJson(res,error.status||500,{error:error.message});}
  }
  if (pathname === "/api/publishing" && req.method === "POST") {
    try { const user=await supabase.verifyUser(req),input=await readBody(req),workspace=await supabase.getWorkspace(req,input.workspaceId);if(!workspace||!workspace.state?.site?.approved)return sendJson(res,400,{error:"Approve the launch page before publishing"});const base=String(input.slug||workspace.name).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,50)||"launch";const value={user_id:user.id,workspace_id:workspace.id,slug:`${base}-${workspace.id.slice(0,6)}`,title:workspace.state.plan?.name||workspace.name,snapshot:workspace.state.site,published:true,published_at:new Date().toISOString(),updated_at:new Date().toISOString()};return sendJson(res,200,{page:await supabase.publishPage(req,value)}); } catch(error){return sendJson(res,error.status||500,{error:error.message});}
  }
  if (pathname === "/api/publishing" && req.method === "DELETE") {
    try { const input=await readBody(req);return sendJson(res,200,{page:await supabase.unpublishPage(req,input.workspaceId)}); } catch(error){return sendJson(res,error.status||500,{error:error.message});}
  }
  if (pathname.startsWith("/api/leads/") && req.method === "PATCH") {
    try {
      if (!supabase.configured()) return sendJson(res, 503, { error: "Supabase is required for lead management" });
      const id = decodeURIComponent(pathname.slice("/api/leads/".length)), input = await readBody(req), status = String(input.status || "");
      if (!new Set(["new", "contacted", "qualified", "archived"]).has(status)) return sendJson(res, 400, { error: "Choose a valid lead status" });
      const lead = await supabase.updateLead(req, id, status);
      return lead ? sendJson(res, 200, { lead }) : sendJson(res, 404, { error: "Lead not found" });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/billing/status" && req.method === "GET") return sendJson(res, 200, billing.status());
  if (pathname === "/api/billing/subscription" && req.method === "GET") {
    try { const user=await supabase.verifyUser(req),subscription=await supabase.getSubscription(req);return sendJson(res, 200, { subscription,entitlement:entitlements.resolveEntitlement({billingEnabled:billing.status().enabled,subscription,user}) }); }
    catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/billing/checkout" && req.method === "POST") {
    try { const user = await supabase.verifyUser(req); const input = await readBody(req); const session = await billing.createCheckout(user, input.plan); return sendJson(res, 200, { url: session.url }); }
    catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/billing/portal" && req.method === "POST") {
    try { await supabase.verifyUser(req); const subscription = await supabase.getSubscription(req); const session = await billing.createPortal(subscription?.stripe_customer_id); return sendJson(res, 200, { url: session.url }); }
    catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/stripe/webhook" && req.method === "POST") {
    try {
      const event = billing.verifyWebhook(await readRawBody(req), req.headers["stripe-signature"]);
      if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) await supabase.upsertSubscription(subscriptionRecord(event.data.object));
      if (event.type === "checkout.session.completed" && event.data.object.subscription) {
        const subscription = await billing.retrieveSubscription(event.data.object.subscription);
        await supabase.upsertSubscription(subscriptionRecord(subscription, { user_id: event.data.object.metadata?.supabase_user_id }));
      }
      const invoiceSubscriptionId = billing.invoiceSubscriptionId(event.data.object);
      if (["invoice.paid", "invoice.payment_failed"].includes(event.type) && invoiceSubscriptionId) {
        const subscription = await billing.retrieveSubscription(invoiceSubscriptionId);
        const existing = await supabase.findSubscriptionByStripeId(subscription.id);
        await supabase.upsertSubscription(subscriptionRecord(subscription, existing || {}));
      }
      return sendJson(res, 200, { received: true });
    } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
  }
  if (pathname === "/api/config" && req.method === "GET") return sendJson(res, 200, { supabase: supabase.publicConfig(), storage: supabase.configured() ? "supabase" : "sqlite" });
  if (pathname === "/api/execution/verify" && req.method === "POST") {
    try {
      if(rateLimited(req,"execution-verify",60))return sendJson(res,429,{error:"Too many verification attempts"});
      const input=await readBody(req),workspaceId=String(input.workspaceId||"").trim();
      if(!workspaceId)return sendJson(res,400,{error:"Workspace is required"});
      const workspace=supabase.configured()?await supabase.getWorkspace(req,workspaceId):database.getWorkspace(workspaceId);
      if(!workspace)return sendJson(res,404,{error:"Workspace not found"});
      const task=(workspace.state?.executionTasks||[]).find(item=>item.id===String(input.taskId||""));
      if(!task)return sendJson(res,404,{error:"Approved execution task not found"});
      if(task.status!=="done")return sendJson(res,409,{error:"Confirm the task result before submitting evidence"});
      const verification=execution.verifyEvidence(input),createdAt=new Date().toISOString(),proof={id:crypto.randomUUID(),...verification,risk:execution.classifyRisk(task),createdAt};
      proof.receipt=execution.signReceipt(workspaceId,proof,receiptSecret());
      const state={...(workspace.state||{}),executionProofs:[proof,...(workspace.state?.executionProofs||[]).filter(item=>item.taskId!==task.id)].slice(0,200)};
      state.activities=[...(state.activities||[]),{title:proof.status==="verified"?"Execution outcome independently verified":"Execution evidence needs revision",detail:`${String(task.title||"").slice(0,70)} · reviewer score ${proof.score}/100`,receipt:proof.receipt.slice(0,12)}];
      const saved=supabase.configured()?await supabase.saveWorkspace(req,workspaceId,state):database.saveWorkspace(workspaceId,state);
      if(!saved)return sendJson(res,500,{error:"Verification could not be saved"});
      return sendJson(res,200,{proof,executionProofs:state.executionProofs,activities:state.activities});
    } catch(error){return sendJson(res,error.status||500,{error:error.message});}
  }
  if (pathname === "/api/validation" && req.method === "GET") {
    try {
      if (!supabase.configured()) return sendJson(res, 200, { entries: [] });
      const workspace = requestUrl.searchParams.get("workspace");
      if (!workspace) return sendJson(res, 400, { error: "Workspace is required" });
      return sendJson(res, 200, { entries: await supabase.listValidation(req, workspace) });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/validation" && req.method === "POST") {
    try {
      if (!supabase.configured()) return sendJson(res, 503, { error: "Supabase is required for validation evidence" });
      const input = await readBody(req);
      const value = {
        workspace_id: String(input.workspaceId || ""),
        respondent_name: String(input.respondentName || "").trim().slice(0, 100),
        respondent_email: String(input.respondentEmail || "").trim().slice(0, 254) || null,
        notes: String(input.notes || "").trim().slice(0, 4000),
        demand_score: Number(input.demandScore), urgency_score: Number(input.urgencyScore), willingness_score: Number(input.willingnessScore)
      };
      if (!value.workspace_id || !value.respondent_name || !value.notes || ![value.demand_score,value.urgency_score,value.willingness_score].every(score => Number.isInteger(score) && score >= 1 && score <= 5)) return sendJson(res, 400, { error: "Complete every required validation field" });
      return sendJson(res, 201, { entry: await supabase.createValidation(req, value) });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname.startsWith("/api/validation/") && req.method === "DELETE") {
    try { await supabase.deleteValidation(req, pathname.split("/").pop()); return sendJson(res, 200, { deleted: true }); }
    catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/workspaces" && req.method === "GET") {
    try {
      if (supabase.configured()) return sendJson(res, 200, { workspaces: await supabase.listWorkspaces(req), defaultId: null });
      return sendJson(res, 200, { workspaces: database.listWorkspaces(), defaultId: database.ensureDefaultWorkspace() });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/workspaces" && req.method === "POST") {
    try { const input = await readBody(req);if(supabase.configured()){const user=await supabase.verifyUser(req),access=await accountEntitlement(req,user),count=(await supabase.listWorkspaces(req)).length;entitlements.assertWorkspaceAccess(access,count);return sendJson(res,201,await supabase.createWorkspace(req,input.name));}return sendJson(res,201,database.createWorkspace(input.name)); }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (pathname.startsWith("/api/workspaces/") && req.method === "PATCH") {
    try {
      const id = decodeURIComponent(pathname.slice("/api/workspaces/".length));
      const input = await readBody(req);
      const raw = supabase.configured() ? await supabase.renameWorkspace(req, id, input.name) : database.renameWorkspace(id, input.name);
      const workspace = raw && supabase.configured() ? { id: raw.id, name: raw.name, state: raw.state, createdAt: raw.created_at, updatedAt: raw.updated_at } : raw;
      return workspace ? sendJson(res, 200, workspace) : sendJson(res, 404, { error: "Workspace not found" });
    } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
  }
  if (pathname.startsWith("/api/workspaces/") && req.method === "DELETE") {
    try {
      const id = decodeURIComponent(pathname.slice("/api/workspaces/".length));
      const deleted = supabase.configured() ? await supabase.deleteWorkspace(req, id) : database.deleteWorkspace(id);
      return deleted ? sendJson(res, 200, { deleted: true }) : sendJson(res, 404, { error: "Workspace not found" });
    } catch (error) { return sendJson(res, error.status || 400, { error: error.message }); }
  }
  if (pathname === "/api/state" && req.method === "GET") {
    try {
      const raw = supabase.configured() ? await supabase.getWorkspace(req, requestUrl.searchParams.get("workspace")) : database.getWorkspace(requestUrl.searchParams.get("workspace"));
      const workspace = raw && supabase.configured() ? { id: raw.id, name: raw.name, state: raw.state, createdAt: raw.created_at, updatedAt: raw.updated_at } : raw;
      return workspace ? sendJson(res, 200, workspace) : sendJson(res, 404, { error: "Workspace not found" });
    } catch (error) { return sendJson(res, error.status || 500, { error: error.message }); }
  }
  if (pathname === "/api/providers" && req.method === "GET") return sendJson(res, 200, router.providerStatus());
  if (pathname === "/api/reseller/social/status" && req.method === "GET") {
    try {
      const workspaceId=requestUrl.searchParams.get("workspace"),workspace=supabase.configured()?await supabase.getWorkspace(req,workspaceId):database.getWorkspace(workspaceId);
      if(!workspace)return sendJson(res,404,{error:"Workspace not found"});
      const permissions=toolPermissions.normalizePermissions(workspace.state?.toolPermissions),instagram=await verifyInstagramConnection();
      return sendJson(res,200,{publishAllowed:permissions.marketing.publish,networks:[{id:"x",name:"X",configured:false,publishing:false,reason:"Connect X before publishing"},{id:"facebook",name:"Facebook",configured:false,publishing:false,reason:"Connect Facebook before publishing"},{id:"instagram",name:"Instagram",...instagram}]});
    }catch(error){return sendJson(res,error.status||500,{error:error.message||"Social connections could not load"});}
  }
  if (pathname === "/api/reseller/social/creative" && req.method === "POST") {
    try {
      const input=await readBody(req),workspaceId=String(input.workspaceId||""),campaignId=String(input.campaignId||""),assetUrl=new URL(String(input.assetUrl||"")),appUrl=new URL(String(process.env.APP_URL||"https://nova-ai-tau-one.vercel.app"));
      if(assetUrl.origin!==appUrl.origin||!assetUrl.pathname.startsWith("/social/")||!staticFiles.has(assetUrl.pathname))return sendJson(res,400,{error:"Choose a Nova-hosted campaign creative"});
      const workspace=supabase.configured()?await supabase.getWorkspace(req,workspaceId):database.getWorkspace(workspaceId);if(!workspace)return sendJson(res,404,{error:"Workspace not found"});if(supabase.configured())await supabase.verifyUser(req);
      const campaigns=Array.isArray(workspace.state?.resellerStudio?.contentCampaigns)?workspace.state.resellerStudio.contentCampaigns:[],campaign=campaigns.find(item=>item.id===campaignId);if(!campaign)return sendJson(res,404,{error:"Content item not found"});if(campaign.status==="published")return sendJson(res,409,{error:"Published content cannot be replaced"});
      campaign.mediaUrl=assetUrl.href;campaign.mediaType="image/png";campaign.status="approved";campaign.approvedAt=new Date().toISOString();
      const state={...(workspace.state||{}),resellerStudio:{...(workspace.state?.resellerStudio||{}),contentCampaigns:campaigns}};if(supabase.configured())await supabase.saveWorkspace(req,workspaceId,state);else database.saveWorkspace(workspaceId,state);
      return sendJson(res,200,{campaign});
    }catch(error){return sendJson(res,error.status||400,{error:error.message||"Creative could not be attached"});}
  }
  if (pathname === "/api/reseller/social/publish" && req.method === "POST") {
    try {
      const input=await readBody(req),workspaceId=String(input.workspaceId||""),campaignId=String(input.campaignId||""),platform=String(input.platform||""),workspace=supabase.configured()?await supabase.getWorkspace(req,workspaceId):database.getWorkspace(workspaceId);
      if(!workspace)return sendJson(res,404,{error:"Workspace not found"});
      if(platform!=="instagram")return sendJson(res,503,{error:`Connect ${platform} before publishing`});
      const permissions=toolPermissions.normalizePermissions(workspace.state?.toolPermissions);if(!permissions.marketing.publish)return sendJson(res,403,{error:"Enable Marketing publish permission in Connections before posting"});
      const campaigns=Array.isArray(workspace.state?.resellerStudio?.contentCampaigns)?workspace.state.resellerStudio.contentCampaigns:[],campaign=campaigns.find(item=>item.id===campaignId);
      if(!campaign)return sendJson(res,404,{error:"Content item not found"});
      if(!["approved","published"].includes(campaign.status))return sendJson(res,409,{error:"Approve this content before publishing"});
      if(!Array.isArray(campaign.platforms)||!campaign.platforms.includes(platform))return sendJson(res,400,{error:"Instagram is not selected for this content"});
      if((campaign.receipts||[]).some(item=>item.platform===platform))return sendJson(res,409,{error:"This content has already been published to Instagram"});
      if(supabase.configured())await supabase.verifyUser(req);
      const postId=await publishInstagram(campaign),publishedAt=new Date().toISOString();campaign.receipts=[...(campaign.receipts||[]),{platform,postId,publishedAt}];campaign.status=campaign.platforms.every(network=>campaign.receipts.some(item=>item.platform===network))?"published":"approved";if(campaign.status==="published")campaign.publishedAt=publishedAt;
      const state={...(workspace.state||{}),resellerStudio:{...(workspace.state?.resellerStudio||{}),contentCampaigns:campaigns}};if(supabase.configured())await supabase.saveWorkspace(req,workspaceId,state);else database.saveWorkspace(workspaceId,state);
      return sendJson(res,200,{published:true,platform,postId,campaign});
    }catch(error){return sendJson(res,error.status||502,{error:error.message||"Approved content could not be published"});}
  }
  if (pathname === "/api/reseller/listings" && req.method === "POST") {
    try {
      if(rateLimited(req,"reseller-listings",20))return sendJson(res,429,{error:"The Listing Agent reached its hourly preparation limit"});
      const user=supabase.configured()?await supabase.verifyUser(req):null,input=await readBody(req),workspaceId=String(input.workspaceId||"").trim(),products=Array.isArray(input.products)?input.products.slice(0,5):[];
      if(!workspaceId||!products.length)return sendJson(res,400,{error:"Choose at least one product to prepare"});
      if(products.some(product=>!String(product.name||"").trim()||!String(product.category||"").trim()||String(product.description||"").trim().length<10))return sendJson(res,400,{error:"Every product needs a name, category, and verified details"});
      const access=entitlements.assertGenerationAccess(await accountEntitlement(req,user));await enforceAiBudget(req,workspaceId,access.tokenCeiling);const results=[];
      for(const product of products)results.push(await router.generateResellerListing({product:{name:String(product.name).slice(0,100),sku:String(product.sku||"").slice(0,40),category:String(product.category).slice(0,60),price:Math.max(0,Number(product.price)||0),quantity:Math.max(0,Math.floor(Number(product.quantity)||0)),condition:String(product.condition||"").slice(0,40),channel:String(product.channel||"").slice(0,60),description:String(product.description).slice(0,1200)},userId:user?.id,workspaceId}));
      return sendJson(res,200,{listings:results});
    }catch(error){return sendJson(res,error.status||502,{error:error.message})}
  }
  if (pathname === "/api/state" && req.method === "PUT") {
    try {
      const value = await readBody(req);
      const workspaceId=requestUrl.searchParams.get("workspace"),existing=supabase.configured()?await supabase.getWorkspace(req,workspaceId):database.getWorkspace(workspaceId);
      if(!existing)return sendJson(res,404,{error:"Workspace not found"});
      value.executionProofs=(existing.state?.executionProofs||[]).filter(proof=>execution.validReceipt(workspaceId,proof,receiptSecret()));
      value.durableMissions=existing.state?.durableMissions||[];
      value.toolPermissions=toolPermissions.normalizePermissions(existing.state?.toolPermissions);
      const raw = supabase.configured() ? await supabase.saveWorkspace(req, workspaceId, value) : database.saveWorkspace(workspaceId, value);
      const workspace = raw && supabase.configured() ? { id: raw.id, name: raw.name, state: raw.state, createdAt: raw.created_at, updatedAt: raw.updated_at } : raw;
      return workspace ? sendJson(res, 200, workspace) : sendJson(res, 404, { error: "Workspace not found" });
    }
    catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (pathname === "/api/generate" && req.method === "POST") {
    try {
      const user = supabase.configured() ? await supabase.verifyUser(req) : null;
      const input = await readBody(req);
      if (!input.idea || !input.customer) return sendJson(res, 400, { error: "Idea and customer are required" });
      const access=entitlements.assertGenerationAccess(await accountEntitlement(req,user));
      await enforceAiBudget(req,input.workspaceId,access.tokenCeiling);
      input.userId=user?.id;
      return sendJson(res, 200, await generateWithOpenAI(input));
    } catch (error) { return sendJson(res, error.status||502, { error: error.message }); }
  }
  if (pathname === "/api/workforce/run" && req.method === "POST") {
    try {
      if (rateLimited(req, "workforce", 12)) return sendJson(res, 429, { error: "The workforce has reached its hourly assignment limit" });
      const user = supabase.configured() ? await supabase.verifyUser(req) : null;
      const input = await readBody(req), goal = String(input.goal || "").trim().slice(0, 1200);
      if (goal.length < 12) return sendJson(res, 400, { error: "Give the team a more specific objective" });
      const access=entitlements.assertGenerationAccess(await accountEntitlement(req,user));
      await enforceAiBudget(req,input.workspaceId,access.tokenCeiling);
      const value = { goal, department:String(input.department || "company").slice(0,30),priority:String(input.priority || "normal").slice(0,20),company:String(input.company || "Nova venture").slice(0,100),context:input.context && typeof input.context === "object" ? input.context : null,userId:user?.id,workspaceId:String(input.workspaceId||"").slice(0,80) };
      return sendJson(res, 200, { run:await runWorkforce(value) });
    } catch (error) { return sendJson(res, error.status || 502, { error:error.message }); }
  }
  const asset = staticFiles.get(pathname);
  if (!asset) return res.writeHead(404).end("Not found");
  res.writeHead(200, { "Content-Type": types[path.extname(asset[0])] || "application/octet-stream" });
  res.end(asset[1]);
});

module.exports = app;
if (require.main === module) app.listen(port, "127.0.0.1", () => console.log(`Nova.Ai running at http://localhost:${port}`));
