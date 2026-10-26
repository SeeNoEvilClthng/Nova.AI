// Revenue Engine: connects a company's own Stripe account, turns approved
// offers into live checkout links, and syncs paid orders into a verified
// revenue ledger. Revenue figures come only from payments Stripe reports;
// nothing the browser saves can create or change an order.
const { orderFromSession, safeCheckoutUrl } = require("./founder-stripe");

function httpError(message, status) { return Object.assign(new Error(message), { status }); }

function summarize(orders, { views = 0 } = {}) {
  const currency = orders[0]?.currency || "USD";
  const sameCurrency = orders.filter(order => order.currency === currency);
  const gross = sameCurrency.reduce((sum, order) => sum + Number(order.amount_minor || 0), 0);
  const refunded = sameCurrency.reduce((sum, order) => sum + Number(order.refunded_minor || 0), 0);
  return {
    currency,
    grossMinor: gross,
    refundedMinor: refunded,
    netMinor: gross - refunded,
    orders: orders.length,
    otherCurrencyOrders: orders.length - sameCurrency.length,
    views,
    // Paid orders per recorded landing-page visit; null until there is traffic.
    conversionRate: views > 0 ? orders.length / views : null,
    testModeOrders: orders.filter(order => order.mode === "test").length
  };
}

// Browser saves can drop server-created checkout details (for example a stale
// tab). Keep them attached to the matching offer.
function mergeOfferCheckouts(existingOffers, incomingOffers) {
  if (!Array.isArray(incomingOffers)) return incomingOffers;
  const saved = new Map((Array.isArray(existingOffers) ? existingOffers : []).filter(offer => offer?.checkout).map(offer => [offer.id, offer.checkout]));
  return incomingOffers.map(offer => offer && !offer.checkout && saved.has(offer.id) ? { ...offer, checkout: saved.get(offer.id) } : offer);
}

function createRevenueEngine({ store, stripe, secretBox }) {
  async function apiKeyFor(workspaceId) {
    const connection = await store.getConnection(workspaceId);
    if (!connection) throw httpError("Connect this company's Stripe account first", 409);
    return { connection, apiKey: secretBox.open({ ciphertext: connection.encrypted_key, iv: connection.key_iv, tag: connection.key_tag }) };
  }

  return {
    async status(workspaceId) {
      const connection = await store.getConnection(workspaceId);
      return { connected: Boolean(connection), mode: connection?.mode || null, connectedAt: connection?.created_at || null, lastSyncedAt: connection?.last_synced_at || null, encryptionReady: secretBox.ready() };
    },

    async connect({ workspaceId, userId, apiKey, confirmOwnership }) {
      if (confirmOwnership !== true) throw httpError("Confirm that this Stripe account belongs to this company and that you authorize Nova to create checkout links", 400);
      const key = String(apiKey || "").trim();
      const { mode } = await stripe.verify(key);
      const sealed = secretBox.seal(key);
      await store.saveConnection({ workspace_id: workspaceId, user_id: userId, provider: "stripe", mode, encrypted_key: sealed.ciphertext, key_iv: sealed.iv, key_tag: sealed.tag, key_hint: `${key.slice(0, 8)}…${key.slice(-4)}` });
      return { connected: true, mode };
    },

    async disconnect(workspaceId) {
      await store.deleteConnection(workspaceId);
      return { connected: false };
    },

    // Creating a public checkout link is an external, customer-facing action,
    // so it needs an explicit founder confirmation on every call.
    async createCheckout({ workspace, offerId, confirm, successUrl }) {
      if (confirm !== true) throw httpError("Confirm that this offer should go live for customers", 400);
      const offers = Array.isArray(workspace.state?.offers) ? workspace.state.offers : [];
      const offer = offers.find(item => item.id === offerId);
      if (!offer) throw httpError("Offer not found", 404);
      if (offer.checkout?.url) throw httpError("This offer already has a checkout link", 409);
      if (!String(offer.name || "").trim() || !(Number(offer.price) >= 0.5)) throw httpError("The offer needs a name and a price of at least 0.50", 400);
      const { apiKey, connection } = await apiKeyFor(workspace.id);
      const attempt = Number(offer.checkoutAttempt || 0) + 1;
      const checkout = await stripe.createCheckout(apiKey, { offer, workspaceId: workspace.id, successUrl, attempt });
      const updated = { ...offer, status: "active", checkoutAttempt: attempt, checkout: { ...checkout, mode: connection.mode, createdAt: new Date().toISOString() }, updatedAt: new Date().toISOString() };
      return { offer: updated, offers: offers.map(item => item.id === offerId ? updated : item) };
    },

    async setOfferActive({ workspace, offerId, active }) {
      const offers = Array.isArray(workspace.state?.offers) ? workspace.state.offers : [];
      const offer = offers.find(item => item.id === offerId);
      if (!offer) throw httpError("Offer not found", 404);
      if (offer.checkout?.paymentLinkId) {
        const { apiKey } = await apiKeyFor(workspace.id);
        await stripe.setLinkActive(apiKey, offer.checkout.paymentLinkId, active);
      }
      const updated = { ...offer, status: active ? "active" : "paused", updatedAt: new Date().toISOString() };
      return { offer: updated, offers: offers.map(item => item.id === offerId ? updated : item) };
    },

    // Pulls paid checkout sessions for every offer's link. Order rows are
    // upserted by Stripe session ID, so repeated syncs never double count.
    async sync({ workspaceId, offers }) {
      const { apiKey, connection } = await apiKeyFor(workspaceId);
      const linked = (Array.isArray(offers) ? offers : []).filter(offer => offer?.checkout?.paymentLinkId);
      const rows = [];
      for (const offer of linked) {
        const sessions = await stripe.paidSessions(apiKey, offer.checkout.paymentLinkId);
        rows.push(...sessions.map(session => orderFromSession(session, { workspaceId, offerId: offer.id, mode: connection.mode })));
      }
      if (rows.length) await store.upsertOrders(rows);
      const syncedAt = new Date().toISOString();
      await store.markSynced(workspaceId, syncedAt);
      return { syncedAt, offersChecked: linked.length, ordersSeen: rows.length };
    }
  };
}

// Public pages only ever render Stripe-hosted checkout addresses.
function publicOffers(offers) {
  return (Array.isArray(offers) ? offers : []).filter(offer => offer?.status === "active" && safeCheckoutUrl(offer.checkout?.url)).slice(0, 3).map(offer => ({ name: String(offer.name || ""), description: String(offer.description || ""), price: Number(offer.price || 0), currency: String(offer.currency || "USD"), billing: String(offer.billing || "one_time"), url: safeCheckoutUrl(offer.checkout.url) }));
}

module.exports = { createRevenueEngine, summarize, mergeOfferCheckouts, publicOffers };
