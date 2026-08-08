const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const billing = require("./billing");

test("billing stays disabled without a test key", () => {
  const previous = process.env.STRIPE_SECRET_KEY;
  process.env.STRIPE_SECRET_KEY = "sk_live_safety_test";
  assert.equal(billing.status().enabled, false);
  assert.equal(billing.status().mode, "live");
  if (previous === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previous;
});

test("verifies a valid Stripe webhook signature", () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_nova_test";
  const body = JSON.stringify({ id: "evt_test", type: "customer.subscription.updated" });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(billing.verifyWebhook(body, `t=${timestamp},v1=${signature}`).id, "evt_test");
  if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous;
});

test("rejects an invalid Stripe webhook signature", () => {
  const previous = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_nova_test";
  const body = JSON.stringify({ id: "evt_test" });
  const timestamp = Math.floor(Date.now() / 1000);
  assert.throws(() => billing.verifyWebhook(body, `t=${timestamp},v1=${"0".repeat(64)}`), /Invalid Stripe signature/);
  if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = previous;
});

test("supports current Stripe invoice and billing-period shapes", () => {
  assert.equal(billing.invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } }), "sub_new");
  assert.equal(billing.invoiceSubscriptionId({ subscription: "sub_legacy" }), "sub_legacy");
  assert.equal(billing.subscriptionPeriodEnd({ items: { data: [{ current_period_end: 200 }, { current_period_end: 300 }] } }), 300);
});
