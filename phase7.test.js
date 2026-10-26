const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
process.env.NOVA_ENCRYPTION_KEY = "c".repeat(64);
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { verifyStripeSignature, createFounderStripe, WEBHOOK_EVENTS } = require("./founder-stripe");
const { createRevenueEngine } = require("./revenue-engine");
const secretBox = require("./secret-box");

const sign = (body, secret, timestamp = Math.floor(Date.now() / 1000)) => `t=${timestamp},v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

test("founder webhook signatures are verified with the company's own secret", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  assert.equal(verifyStripeSignature(body, sign(body, "whsec_a"), "whsec_a").id, "evt_1");
  assert.throws(() => verifyStripeSignature(body, sign(body, "whsec_other"), "whsec_a"), /Invalid Stripe signature/);
  assert.throws(() => verifyStripeSignature(body, sign(body, "whsec_a", Math.floor(Date.now() / 1000) - 600), "whsec_a"), /Expired/);
  assert.throws(() => verifyStripeSignature(body.replace("evt_1", "evt_2"), sign(body, "whsec_a"), "whsec_a"), /Invalid/);
});

test("webhook creation subscribes only to revenue events", async () => {
  let request;
  const fetchImpl = async (url, init) => { request = { url, body: new URLSearchParams(init.body.toString()) }; return { ok: true, json: async () => ({ id: "we_1", secret: "whsec_new" }) }; };
  const endpoint = await createFounderStripe({ fetchImpl }).createWebhook("rk_test_abcdefghij1", { url: "https://nova.test/api/stripe/founder-webhook/w1", workspaceId: "w1" });
  assert.deepEqual(endpoint, { id: "we_1", secret: "whsec_new" });
  assert.match(request.url, /\/webhook_endpoints$/);
  assert.deepEqual([...request.body.entries()].filter(([key]) => key.startsWith("enabled_events")).map(([, value]) => value), WEBHOOK_EVENTS);
});

function setup(stripeOverrides = {}) {
  const connections = new Map();
  const store = { getConnection: async id => connections.get(id) || null, saveConnection: async row => connections.set(row.workspace_id, { ...row }), deleteConnection: async id => connections.delete(id), saveWebhook: async (id, values) => Object.assign(connections.get(id), values), upsertOrders: async () => {}, markSynced: async () => {} };
  const calls = [];
  const stripe = { verify: async () => ({ mode: "test" }), createWebhook: async (key, input) => { calls.push(["create", input.url]); return { id: "we_1", secret: "whsec_company" }; }, deleteWebhook: async (key, id) => { calls.push(["delete", id]); }, ...stripeOverrides };
  return { connections, calls, engine: createRevenueEngine({ store, stripe, secretBox }) };
}

test("instant updates store the endpoint secret encrypted and verify events with it", async () => {
  const { connections, calls, engine } = setup();
  await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  await assert.rejects(engine.enableInstantUpdates({ workspaceId: "w1", webhookUrl: "http://insecure" }), /HTTPS/);
  assert.deepEqual(await engine.enableInstantUpdates({ workspaceId: "w1", webhookUrl: "https://nova.test/api/stripe/founder-webhook/w1" }), { instantUpdates: true });
  assert.ok(!JSON.stringify(connections.get("w1")).includes("whsec_company"));
  assert.equal((await engine.status("w1")).instantUpdates, true);
  assert.equal((await engine.enableInstantUpdates({ workspaceId: "w1", webhookUrl: "https://nova.test/x" })).alreadyEnabled, true);
  assert.equal(calls.filter(call => call[0] === "create").length, 1);
  const body = JSON.stringify({ id: "evt_9", type: "charge.refunded" });
  assert.deepEqual(await engine.handleWebhook({ workspaceId: "w1", rawBody: body, signature: sign(body, "whsec_company") }), { event: { id: "evt_9", type: "charge.refunded" }, relevant: true });
  await assert.rejects(engine.handleWebhook({ workspaceId: "w1", rawBody: body, signature: sign(body, "whsec_attacker") }), /Invalid/);
  await assert.rejects(engine.handleWebhook({ workspaceId: "w2", rawBody: body, signature: sign(body, "whsec_company") }), error => error.status === 404);
});

test("disconnecting removes Nova's webhook from the founder's account", async () => {
  const { calls, engine } = setup();
  await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  await engine.enableInstantUpdates({ workspaceId: "w1", webhookUrl: "https://nova.test/api/stripe/founder-webhook/w1" });
  assert.deepEqual(await engine.disconnect("w1"), { connected: false, webhookRemoved: true });
  assert.deepEqual(calls.at(-1), ["delete", "we_1"]);
  const failing = setup({ deleteWebhook: async () => { throw new Error("no permission"); } });
  await failing.engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  await failing.engine.enableInstantUpdates({ workspaceId: "w1", webhookUrl: "https://nova.test/x" });
  assert.equal((await failing.engine.disconnect("w1")).webhookRemoved, false);
});

test("the webhook endpoint rejects unknown paths and requires configuration", async () => {
  const app = require("./server"), server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/stripe/founder-webhook/00000000-0000-0000-0000-000000000000`, { method: "POST", body: "{}" })).status, 503);
    assert.equal((await fetch(`${base}/api/stripe/founder-webhook/not-a-uuid`, { method: "POST", body: "{}" })).status, 404);
  } finally { server.close(); }
});
