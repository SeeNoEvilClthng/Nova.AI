// Minimal Stripe client for a founder's OWN Stripe account (company revenue),
// kept separate from billing.js, which handles Nova's platform subscriptions.
// Founders connect with a restricted key, so Nova can create checkout links
// and read payments but can never move money, issue refunds, or change payouts.
const STRIPE_API = "https://api.stripe.com/v1";

// Restricted-key permissions the founder must grant.
const REQUIRED_PERMISSIONS = [
  ["Products", "Write"], ["Prices", "Write"], ["Payment Links", "Write"],
  ["Checkout Sessions", "Read"], ["PaymentIntents", "Read"], ["Charges", "Read"], ["Invoices", "Read"]
];
// Optional: lets Nova register a webhook for instant updates.
const OPTIONAL_PERMISSIONS = [["Webhook Endpoints", "Write"]];
const WEBHOOK_EVENTS = ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "invoice.paid"];

// Stripe-Signature check (t=timestamp,v1=HMAC) against one company's own
// endpoint secret. Rejects anything older than five minutes (replays).
function verifyStripeSignature(rawBody, header, secret, now = Date.now()) {
  const parts = String(header || "").split(",").reduce((out, item) => { const [key, value] = item.split("="); if (key && value) (out[key] ||= []).push(value); return out; }, {});
  const timestamp = Number(parts.t?.[0]);
  if (!timestamp || Math.abs(now / 1000 - timestamp) > 300) throw Object.assign(new Error("Expired or missing Stripe signature"), { status: 400 });
  const expected = require("node:crypto").createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const valid = (parts.v1 || []).some(value => value.length === expected.length && require("node:crypto").timingSafeEqual(Buffer.from(value), Buffer.from(expected)));
  if (!valid) throw Object.assign(new Error("Invalid Stripe signature"), { status: 400 });
  return JSON.parse(rawBody);
}

function keyMode(apiKey) {
  const key = String(apiKey || "").trim();
  if (/^sk_(test|live)_/.test(key)) throw Object.assign(new Error("Use a restricted key (rk_…), not a full secret key. Nova only needs the permissions listed."), { status: 400 });
  const match = key.match(/^rk_(test|live)_[A-Za-z0-9]{10,}$/);
  if (!match) throw Object.assign(new Error("That doesn't look like a Stripe restricted key. It should start with rk_test_ or rk_live_."), { status: 400 });
  return match[1];
}

// Stripe expects nested form fields such as line_items[0][price].
function encodeForm(value, prefix = "", out = new URLSearchParams()) {
  if (value === undefined || value === null) return out;
  if (typeof value === "object" && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) encodeForm(item, prefix ? `${prefix}[${key}]` : key, out);
  else if (Array.isArray(value)) value.forEach((item, index) => encodeForm(item, `${prefix}[${index}]`, out));
  else out.append(prefix, String(value));
  return out;
}

const BILLING_INTERVAL = { monthly: "month", yearly: "year" };
const minorUnits = amount => Math.round(Number(amount) * 100);
const ALLOWED_CHECKOUT_HOSTS = new Set(["buy.stripe.com", "checkout.stripe.com"]);
function safeCheckoutUrl(url) {
  try { const parsed = new URL(String(url)); return parsed.protocol === "https:" && ALLOWED_CHECKOUT_HOSTS.has(parsed.hostname) ? parsed.href : null; } catch { return null; }
}

function createFounderStripe({ fetchImpl = fetch } = {}) {
  async function call(apiKey, method, path, params, idempotencyKey) {
    const query = method === "GET" && params ? `?${encodeForm(params)}` : "";
    const response = await fetchImpl(`${STRIPE_API}${path}${query}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
      body: method === "GET" ? undefined : encodeForm(params || {}),
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = result?.error?.message || `Stripe request failed (${response.status})`;
      const permission = response.status === 403 || /permission/i.test(message);
      throw Object.assign(new Error(permission ? `Stripe refused this action. Check the restricted key has: ${REQUIRED_PERMISSIONS.map(([name, level]) => `${name} ${level}`).join(", ")}. (${message})` : message), { status: permission ? 403 : 502 });
    }
    return result;
  }

  return {
    // Confirms the key works and has the read and write access Nova needs.
    async verify(apiKey) {
      const mode = keyMode(apiKey);
      await call(apiKey, "GET", "/payment_links", { limit: 1 });
      await call(apiKey, "GET", "/checkout/sessions", { limit: 1 });
      return { mode };
    },

    // Creates product -> price -> payment link. Idempotency keys make a retried
    // request return the same objects instead of creating duplicates.
    async createCheckout(apiKey, { offer, workspaceId, successUrl, attempt }) {
      const base = `nova-${workspaceId}-${offer.id}-${attempt}`, metadata = { nova_offer_id: offer.id, nova_workspace_id: workspaceId };
      const product = await call(apiKey, "POST", "/products", { name: offer.name, description: String(offer.description || "").slice(0, 500) || undefined, metadata }, `${base}-product`);
      const interval = BILLING_INTERVAL[offer.billing];
      const price = await call(apiKey, "POST", "/prices", { product: product.id, currency: String(offer.currency || "USD").toLowerCase(), unit_amount: minorUnits(offer.price), ...(interval ? { recurring: { interval } } : {}), metadata }, `${base}-price`);
      const link = await call(apiKey, "POST", "/payment_links", {
        line_items: [{ price: price.id, quantity: 1 }], metadata,
        ...(successUrl ? { after_completion: { type: "redirect", redirect: { url: successUrl } } } : {})
      }, `${base}-link`);
      const url = safeCheckoutUrl(link.url);
      if (!url) throw Object.assign(new Error("Stripe returned an unexpected checkout address"), { status: 502 });
      return { productId: product.id, priceId: price.id, paymentLinkId: link.id, url };
    },

    async setLinkActive(apiKey, paymentLinkId, active) {
      return call(apiKey, "POST", `/payment_links/${encodeURIComponent(paymentLinkId)}`, { active });
    },

    // Paid checkout sessions for one payment link, newest first, up to 1,000.
    async paidSessions(apiKey, paymentLinkId) {
      const sessions = [];
      let startingAfter;
      for (let page = 0; page < 10; page += 1) {
        const result = await call(apiKey, "GET", "/checkout/sessions", { payment_link: paymentLinkId, status: "complete", limit: 100, expand: ["data.payment_intent.latest_charge"], ...(startingAfter ? { starting_after: startingAfter } : {}) });
        sessions.push(...(result.data || []).filter(session => session.payment_status === "paid"));
        if (!result.has_more || !result.data?.length) break;
        startingAfter = result.data[result.data.length - 1].id;
      }
      return sessions;
    },

    // Registers a webhook in the founder's account so Stripe tells Nova about
    // payments, refunds and renewals as they happen. Needs the optional
    // "Webhook Endpoints: Write" permission; without it, polling continues.
    async createWebhook(apiKey, { url, workspaceId }) {
      const endpoint = await call(apiKey, "POST", "/webhook_endpoints", { url, enabled_events: WEBHOOK_EVENTS, description: "Nova.Ai verified revenue sync", metadata: { nova_workspace_id: workspaceId } });
      if (!endpoint.id || !endpoint.secret) throw Object.assign(new Error("Stripe did not return a webhook signing secret"), { status: 502 });
      return { id: endpoint.id, secret: endpoint.secret };
    },

    async deleteWebhook(apiKey, endpointId) {
      return call(apiKey, "DELETE", `/webhook_endpoints/${encodeURIComponent(endpointId)}`);
    },

    // Paid renewal invoices for a subscription started through a payment
    // link. The first invoice is the checkout payment itself, already counted
    // from the session, so it is excluded.
    async renewalInvoices(apiKey, subscriptionId) {
      const result = await call(apiKey, "GET", "/invoices", { subscription: subscriptionId, status: "paid", limit: 100 });
      return (result.data || []).filter(invoice => invoice.billing_reason !== "subscription_create" && Number(invoice.amount_paid) > 0);
    }
  };
}

function orderFromInvoice(invoice, { workspaceId, offerId, mode }) {
  return {
    workspace_id: workspaceId, provider: "stripe", external_id: invoice.id, offer_id: offerId, mode, status: "paid",
    amount_minor: Number(invoice.amount_paid || 0), refunded_minor: 0,
    currency: String(invoice.currency || "usd").toUpperCase(),
    customer_email: String(invoice.customer_email || "").slice(0, 254) || null,
    paid_at: new Date(Number(invoice.status_transitions?.paid_at || invoice.created || 0) * 1000).toISOString()
  };
}

// Turns a Stripe checkout session into a verified-revenue order row.
function orderFromSession(session, { workspaceId, offerId, mode }) {
  const charge = session.payment_intent && typeof session.payment_intent === "object" ? session.payment_intent.latest_charge : null;
  return {
    workspace_id: workspaceId,
    provider: "stripe",
    external_id: session.id,
    offer_id: offerId,
    mode,
    status: "paid",
    amount_minor: Number(session.amount_total || 0),
    refunded_minor: Number(charge && typeof charge === "object" ? charge.amount_refunded || 0 : 0),
    currency: String(session.currency || "usd").toUpperCase(),
    customer_email: String(session.customer_details?.email || "").slice(0, 254) || null,
    // Visitor ID the launch page added to the checkout link (attribution).
    client_reference_id: /^[A-Za-z0-9_-]{8,64}$/.test(String(session.client_reference_id || "")) ? session.client_reference_id : null,
    paid_at: new Date(Number(session.created || 0) * 1000).toISOString()
  };
}

module.exports = { verifyStripeSignature, WEBHOOK_EVENTS, OPTIONAL_PERMISSIONS, createFounderStripe, orderFromSession, orderFromInvoice, keyMode, encodeForm, safeCheckoutUrl, REQUIRED_PERMISSIONS };
