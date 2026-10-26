const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
process.env.NOVA_ENCRYPTION_KEY = "a".repeat(64);
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { createFounderStripe, orderFromSession, keyMode, encodeForm, safeCheckoutUrl } = require("./founder-stripe");
const { createRevenueEngine, summarize, mergeOfferCheckouts, publicOffers } = require("./revenue-engine");
const { cleanOffer } = require("./revenue-routes");
const secretBox = require("./secret-box");
const router = require("./router");

const offer = { id: "offer-1", name: "Bookkeeping pilot", description: "Monthly books for one clinic", price: 149, currency: "USD", billing: "monthly", status: "draft" };

function fakeStripe() {
  const calls = [];
  return {
    calls,
    async verify(key) { calls.push(["verify", key]); return { mode: keyMode(key) }; },
    async createCheckout(key, input) { calls.push(["checkout", key, input]); return { productId: "prod_1", priceId: "price_1", paymentLinkId: "plink_1", url: "https://buy.stripe.com/test_abc" }; },
    async setLinkActive(key, id, active) { calls.push(["active", id, active]); },
    async paidSessions() { return [{ id: "cs_1", amount_total: 14900, currency: "usd", created: 1761500000, customer_details: { email: "a@clinic.test" }, payment_intent: { latest_charge: { amount_refunded: 0 } } }, { id: "cs_2", amount_total: 14900, currency: "usd", created: 1761600000, customer_details: { email: "b@clinic.test" }, payment_intent: { latest_charge: { amount_refunded: 4900 } } }]; }
  };
}
function memoryStore() {
  const connections = new Map(), orders = new Map();
  return { connections, orders, getConnection: async id => connections.get(id) || null, saveConnection: async row => connections.set(row.workspace_id, { ...row, created_at: "now" }), deleteConnection: async id => connections.delete(id), upsertOrders: async rows => rows.forEach(row => orders.set(row.external_id, row)), markSynced: async (id, at) => { connections.get(id).last_synced_at = at; } };
}

test("only Stripe restricted keys are accepted", () => {
  assert.equal(keyMode("rk_test_abcdefghij123"), "test");
  assert.equal(keyMode("rk_live_abcdefghij123"), "live");
  assert.throws(() => keyMode("sk_live_abcdefghij123"), /restricted key/);
  assert.throws(() => keyMode("pk_test_abc"), /restricted key/);
});

test("Stripe form encoding handles nested fields and arrays", () => {
  assert.equal(decodeURIComponent(encodeForm({ line_items: [{ price: "p", quantity: 1 }], after_completion: { type: "redirect" } }).toString()), "line_items[0][price]=p&line_items[0][quantity]=1&after_completion[type]=redirect");
});

test("public pages only link to Stripe-hosted checkout", () => {
  assert.equal(safeCheckoutUrl("https://buy.stripe.com/abc"), "https://buy.stripe.com/abc");
  assert.equal(safeCheckoutUrl("javascript:alert(1)"), null);
  assert.equal(safeCheckoutUrl("https://evil.example/buy"), null);
  const listed = publicOffers([{ ...offer, status: "active", checkout: { url: "https://buy.stripe.com/x" } }, { ...offer, id: "o2", status: "active", checkout: { url: "https://evil.example" } }, { ...offer, id: "o3", status: "paused", checkout: { url: "https://buy.stripe.com/y" } }]);
  assert.deepEqual(listed.map(item => item.url), ["https://buy.stripe.com/x"]);
});

test("checkout creation sends idempotency keys, recurring prices and the thank-you redirect", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push({ url, init }); const body = url.endsWith("/products") ? { id: "prod_1" } : url.endsWith("/prices") ? { id: "price_1" } : { id: "plink_1", url: "https://buy.stripe.com/test_1" }; return { ok: true, json: async () => body }; };
  const result = await createFounderStripe({ fetchImpl }).createCheckout("rk_test_abcdefghij1", { offer, workspaceId: "w1", successUrl: "https://nova.test/p/acme?paid=1", attempt: 1 });
  assert.deepEqual(result, { productId: "prod_1", priceId: "price_1", paymentLinkId: "plink_1", url: "https://buy.stripe.com/test_1" });
  assert.deepEqual(requests.map(item => item.init.headers["Idempotency-Key"]), ["nova-w1-offer-1-1-product", "nova-w1-offer-1-1-price", "nova-w1-offer-1-1-link"]);
  const price = new URLSearchParams(requests[1].init.body.toString()), link = new URLSearchParams(requests[2].init.body.toString());
  assert.equal(price.get("unit_amount"), "14900");
  assert.equal(price.get("recurring[interval]"), "month");
  assert.equal(link.get("after_completion[redirect][url]"), "https://nova.test/p/acme?paid=1");
});

test("Stripe permission errors explain which access the key needs", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: "The provided key does not have the required permissions" } }) });
  await assert.rejects(createFounderStripe({ fetchImpl }).verify("rk_test_abcdefghij1"), error => error.status === 403 && /Payment Links Write/.test(error.message));
});

test("connecting stores only the encrypted key and requires ownership confirmation", async () => {
  const store = memoryStore(), engine = createRevenueEngine({ store, stripe: fakeStripe(), secretBox });
  await assert.rejects(engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1" }), /Confirm/);
  assert.deepEqual(await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true }), { connected: true, mode: "test" });
  const saved = store.connections.get("w1");
  assert.ok(!JSON.stringify(saved).includes("rk_test_abcdefghij1"));
  assert.equal(secretBox.open({ ciphertext: saved.encrypted_key, iv: saved.key_iv, tag: saved.key_tag }), "rk_test_abcdefghij1");
});

test("going live needs explicit confirmation, then syncs paid orders once each", async () => {
  const store = memoryStore(), stripe = fakeStripe(), engine = createRevenueEngine({ store, stripe, secretBox });
  await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  const workspace = { id: "w1", state: { offers: [offer] } };
  await assert.rejects(engine.createCheckout({ workspace, offerId: offer.id }), /Confirm/);
  const { offer: live, offers } = await engine.createCheckout({ workspace, offerId: offer.id, confirm: true, successUrl: null });
  assert.equal(live.status, "active");
  assert.equal(live.checkout.paymentLinkId, "plink_1");
  assert.equal(stripe.calls.find(call => call[0] === "checkout")[1], "rk_test_abcdefghij1");
  await engine.sync({ workspaceId: "w1", offers });
  await engine.sync({ workspaceId: "w1", offers });
  assert.equal(store.orders.size, 2);
  const summary = summarize([...store.orders.values()], { views: 40 });
  assert.deepEqual([summary.grossMinor, summary.refundedMinor, summary.netMinor, summary.orders, summary.conversionRate, summary.testModeOrders], [29800, 4900, 24900, 2, 0.05, 2]);
});

test("pausing an offer deactivates its Stripe link", async () => {
  const store = memoryStore(), stripe = fakeStripe(), engine = createRevenueEngine({ store, stripe, secretBox });
  await engine.connect({ workspaceId: "w1", userId: "u1", apiKey: "rk_test_abcdefghij1", confirmOwnership: true });
  const workspace = { id: "w1", state: { offers: [{ ...offer, status: "active", checkout: { paymentLinkId: "plink_9", url: "https://buy.stripe.com/x" } }] } };
  const { offer: paused } = await engine.setOfferActive({ workspace, offerId: offer.id, active: false });
  assert.equal(paused.status, "paused");
  assert.deepEqual(stripe.calls.at(-1), ["active", "plink_9", false]);
});

test("orders map refunds and customer details from Stripe sessions", () => {
  const row = orderFromSession({ id: "cs_9", amount_total: 5000, currency: "eur", created: 1761500000, customer_details: { email: "x@y.test" }, payment_intent: { latest_charge: { amount_refunded: 1000 } } }, { workspaceId: "w1", offerId: "o1", mode: "live" });
  assert.deepEqual([row.amount_minor, row.refunded_minor, row.currency, row.customer_email, row.mode], [5000, 1000, "EUR", "x@y.test", "live"]);
});

test("browser saves cannot drop server-created checkout details", () => {
  const merged = mergeOfferCheckouts([{ id: "o1", checkout: { url: "https://buy.stripe.com/x" } }], [{ id: "o1", name: "Renamed" }, { id: "o2" }]);
  assert.equal(merged[0].checkout.url, "https://buy.stripe.com/x");
  assert.equal(merged[0].name, "Renamed");
  assert.equal(merged[1].checkout, undefined);
});

test("AI offer drafts are clamped to supported values", () => {
  const draft = cleanOffer({ name: "X", type: "weird", price: 0.1, currency: "JPY", billing: "weekly", description: "d" });
  assert.deepEqual([draft.type, draft.price, draft.currency, draft.billing], ["service", 0.5, "USD", "one_time"]);
});

test("model routing uses per-tier models with a single-model fallback", () => {
  process.env.AI_GATEWAY_MODEL = "provider/base";
  assert.equal(router.modelForTier("fast"), "provider/base");
  process.env.AI_GATEWAY_FAST_MODEL = "provider/fast";
  process.env.AI_GATEWAY_REASONING_MODEL = "provider/smart";
  assert.equal(router.modelForTier("fast"), "provider/fast");
  assert.equal(router.modelForTier("reasoning"), "provider/smart");
  for (const key of ["AI_GATEWAY_MODEL", "AI_GATEWAY_FAST_MODEL", "AI_GATEWAY_REASONING_MODEL"]) delete process.env[key];
});
