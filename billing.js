const crypto = require("crypto");

const stripeSecret = () => process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || "";
const appUrl = () => String(process.env.APP_URL || `http://localhost:${process.env.PORT || 4180}`).replace(/\/$/, "");
const plans = () => ({
  starter: process.env.STRIPE_STARTER_PRICE_ID || "",
  builder: process.env.STRIPE_BUILDER_PRICE_ID || "",
  operator: process.env.STRIPE_OPERATOR_PRICE_ID || ""
});
const mode = () => stripeSecret().startsWith("sk_test_") ? "test" : stripeSecret().startsWith("sk_live_") ? "live" : "unconfigured";
const liveAllowed = () => process.env.ALLOW_STRIPE_LIVE === "true";

function status() {
  const availablePlans = Object.entries(plans()).filter(([, id]) => id).map(([name]) => name);
  const safeMode = mode() === "test" || (mode() === "live" && liveAllowed());
  return { enabled: Boolean(safeMode && availablePlans.length), webhookReady: Boolean(webhookSecret()), availablePlans, mode: mode() };
}

async function stripeRequest(path, options = {}) {
  if (!stripeSecret()) throw Object.assign(new Error("Stripe test billing is not connected yet"), { status: 503 });
  if (mode() === "live" && !liveAllowed()) throw Object.assign(new Error("Live Stripe billing is safety-locked. Connect test mode first."), { status: 503 });
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${stripeSecret()}`, "Content-Type": "application/x-www-form-urlencoded", ...(options.headers || {}) }
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message || "Stripe request failed"), { status: response.status });
  return result;
}

async function createCheckout(user, plan) {
  const price = plans()[plan];
  if (!price) throw Object.assign(new Error("That subscription plan is not available yet"), { status: 400 });
  const body = new URLSearchParams({
    mode: "subscription",
    success_url: `${appUrl()}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/?billing=cancelled`,
    client_reference_id: user.id,
    customer_email: user.email,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    "metadata[supabase_user_id]": user.id,
    "metadata[nova_plan]": plan,
    "subscription_data[metadata][supabase_user_id]": user.id,
    "subscription_data[metadata][nova_plan]": plan
  });
  return stripeRequest("/checkout/sessions", { method: "POST", body });
}

async function createPortal(customerId) {
  if (!customerId) throw Object.assign(new Error("No Stripe customer is connected to this account"), { status: 404 });
  return stripeRequest("/billing_portal/sessions", { method: "POST", body: new URLSearchParams({ customer: customerId, return_url: `${appUrl()}/?view=billing` }) });
}

async function retrieveSubscription(id) {
  return stripeRequest(`/subscriptions/${encodeURIComponent(id)}`);
}

function verifyWebhook(rawBody, signature) {
  if (!webhookSecret()) throw Object.assign(new Error("Stripe webhook secret is not configured"), { status: 503 });
  const values = String(signature || "").split(",").reduce((out, item) => {
    const [key, value] = item.split("=");
    if (key && value) (out[key] ||= []).push(value);
    return out;
  }, {});
  const timestamp = Number(values.t?.[0]);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) throw Object.assign(new Error("Expired Stripe signature"), { status: 400 });
  const expected = crypto.createHmac("sha256", webhookSecret()).update(`${timestamp}.${rawBody}`).digest("hex");
  const valid = (values.v1 || []).some(value => value.length === expected.length && crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected)));
  if (!valid) throw Object.assign(new Error("Invalid Stripe signature"), { status: 400 });
  return JSON.parse(rawBody);
}

function invoiceSubscriptionId(invoice) {
  const value = invoice.subscription || invoice.parent?.subscription_details?.subscription || invoice.parent?.subscription;
  return typeof value === "string" ? value : value?.id || null;
}

function subscriptionPeriodEnd(subscription) {
  return subscription.current_period_end || Math.max(0, ...(subscription.items?.data || []).map(item => Number(item.current_period_end || 0))) || null;
}

module.exports = { status, createCheckout, createPortal, retrieveSubscription, verifyWebhook, plans, invoiceSubscriptionId, subscriptionPeriodEnd };
