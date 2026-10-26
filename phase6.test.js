const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "RESEND_API_KEY", "NOVA_EMAIL_FROM"]) delete process.env[key];

const { cleanAttribution, summarizeBySource } = require("./attribution");
const outreach = require("./email-outreach");
const { orderFromSession } = require("./founder-stripe");

test("attribution keeps clean UTM tags and external referrers only", () => {
  assert.deepEqual(cleanAttribution({ visitorId: "abc12345-xyz", utmSource: " Instagram ", utmMedium: "social", utmCampaign: "<script>", referrer: "https://www.reddit.com/r/x" }, "nova.example"), { visitor_id: "abc12345-xyz", utm_source: "instagram", utm_medium: "social", utm_campaign: null, referrer_host: "reddit.com" });
  assert.equal(cleanAttribution({ referrer: "https://nova.example/p/acme" }, "nova.example").referrer_host, null);
  assert.equal(cleanAttribution({ visitorId: "short" }).visitor_id, null);
});

test("orders are credited to the first-touch source of the visitor who bought", () => {
  const events = [
    { event_type: "view", visitor_id: "visitor-aaaa", utm_source: "instagram", created_at: "2026-10-01" },
    { event_type: "view", visitor_id: "visitor-aaaa", referrer_host: "google.com", created_at: "2026-10-02" },
    { event_type: "view", visitor_id: "visitor-bbbb", referrer_host: "google.com", created_at: "2026-10-03" },
    { event_type: "view", visitor_id: "visitor-cccc", created_at: "2026-10-03" }
  ];
  const sources = summarizeBySource({ events, leads: [{ utm_source: "instagram" }], orders: [{ client_reference_id: "visitor-aaaa", amount_minor: 9900, refunded_minor: 0 }, { client_reference_id: null, amount_minor: 5000 }] });
  const instagram = sources.find(row => row.source === "instagram");
  assert.deepEqual([instagram.visitors, instagram.signups, instagram.orders, instagram.revenueMinor, instagram.signupRate], [1, 1, 1, 9900, 1]);
  assert.equal(sources.find(row => row.source === "unattributed").orders, 1);
  assert.equal(sources.find(row => row.source === "google.com").views, 2);
});

test("checkout sessions keep a valid client_reference_id for attribution", () => {
  assert.equal(orderFromSession({ id: "cs_1", client_reference_id: "visitor-aaaa" }, { workspaceId: "w" }).client_reference_id, "visitor-aaaa");
  assert.equal(orderFromSession({ id: "cs_2", client_reference_id: "bad id!" }, { workspaceId: "w" }).client_reference_id, null);
});

test("unsubscribe links are signed and cannot be forged", () => {
  const token = outreach.unsubscribeToken("lead-123");
  assert.equal(outreach.verifyUnsubscribeToken(token), "lead-123");
  const [payload] = token.split(".");
  assert.equal(outreach.verifyUnsubscribeToken(`${Buffer.from("lead-999").toString("base64url")}.${token.split(".")[1]}`), null);
  assert.equal(outreach.verifyUnsubscribeToken(`${payload}.forged`), null);
});

test("every message says why it was sent and links to unsubscribe", () => {
  const draft = outreach.cleanDraft({ subject: "Hello\r\nBcc: x@y.z", body: "Thanks for signing up, quick question for you." });
  assert.equal(draft.subject, "Hello Bcc: x@y.z");
  const message = outreach.messageFor({ lead: { id: "lead-1", email: "a@b.test" }, draft, company: "Acme", pageUrl: "https://nova.test/p/acme", appUrl: "https://nova.test" });
  assert.match(message.text, /signed up for updates from Acme at https:\/\/nova\.test\/p\/acme/);
  assert.match(message.text, /Unsubscribe: https:\/\/nova\.test\/u\//);
  assert.throws(() => outreach.cleanDraft({ subject: "Hi", body: "short" }), /at least 20/);
});

test("batches respect the per-batch and daily limits and record failures", async () => {
  const leads = Array.from({ length: 120 }, (_, i) => ({ id: `lead-${i}`, email: `l${i}@x.test` }));
  const draft = { subject: "Hi there", body: "Thanks for signing up for updates from us." };
  let calls = 0;
  const { results, skippedForLimits } = await outreach.sendBatch({ leads, draft, company: "Acme", appUrl: "https://nova.test", sentToday: 80, batchId: "b1", send: async () => { calls++; if (calls === 3) throw new Error("mailbox full"); return `msg-${calls}`; } });
  assert.equal(results.length, 20);
  assert.equal(skippedForLimits, 100);
  assert.equal(results.filter(item => item.status === "failed").length, 1);
  const fresh = await outreach.sendBatch({ leads, draft, company: "Acme", appUrl: "https://nova.test", sentToday: 0, batchId: "b2", send: async () => "id" });
  assert.equal(fresh.results.length, outreach.MAX_PER_BATCH);
});

test("Resend requests carry idempotency, reply-to and one-click unsubscribe headers", async () => {
  let captured;
  const fetchImpl = async (url, init) => { captured = { url, init }; return { ok: true, json: async () => ({ id: "re_1" }) }; };
  const id = await outreach.sendViaResend({ config: { apiKey: "re_test", from: "Acme <hi@acme.test>" }, message: { to: "a@b.test", subject: "Hi", text: "Body", unsubscribeUrl: "https://nova.test/u/x.y" }, replyTo: "founder@acme.test", idempotencyKey: "nova-b1-lead-1", fetchImpl });
  const body = JSON.parse(captured.init.body);
  assert.equal(id, "re_1");
  assert.equal(captured.init.headers["Idempotency-Key"], "nova-b1-lead-1");
  assert.equal(body.reply_to, "founder@acme.test");
  assert.equal(body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
});

test("visitor writes fall back when the attribution columns don't exist yet", async () => {
  process.env.SUPABASE_URL = "https://db.test"; process.env.SUPABASE_PUBLISHABLE_KEY = "pk"; process.env.SUPABASE_SECRET_KEY = "sk";
  const realFetch = global.fetch, bodies = [];
  global.fetch = async (url, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? { ok: false, status: 400, text: async () => '{"code":"PGRST204","message":"Could not find the \'visitor_id\' column"}' } : { ok: true, status: 201, json: async () => null }; };
  try {
    const supabase = require("./supabase");
    await supabase.recordPageEvent("page-1", "view", { visitor_id: "visitor-aaaa", utm_source: "x" });
    assert.equal(bodies[0].visitor_id, "visitor-aaaa");
    assert.deepEqual(bodies[1], { page_id: "page-1", event_type: "view" });
  } finally {
    global.fetch = realFetch;
    for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) delete process.env[key];
  }
});

test("the unsubscribe page confirms before acting and rejects bad links", async () => {
  const app = require("./server"), server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/u/not-a-valid.token`)).status, 400);
    const page = await fetch(`${base}/u/${outreach.unsubscribeToken("lead-1")}`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<form method="post">/);
    assert.equal((await fetch(`${base}/api/growth/summary?workspace=x`)).status, 503);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.status, "ok");
  } finally { server.close(); }
});
