// First-touch attribution for published launch pages. The page keeps a
// random visitor ID and the first UTM tags / referring site it saw, sends
// them with page views and signups, and adds the visitor ID to Stripe
// checkout links as client_reference_id so paid orders can be traced back to
// the source that brought the buyer. No cookies or personal data are used.
const TAG = /^[a-z0-9][a-z0-9._+-]{0,79}$/;

function cleanTag(value) {
  const text = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  return TAG.test(text) ? text : null;
}

function cleanVisitorId(value) {
  const text = String(value || "");
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? text : null;
}

function cleanReferrerHost(value, ownHost) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase().replace(/^www\./, "");
    return host && host !== String(ownHost || "").toLowerCase().replace(/^www\./, "") && host.length <= 120 ? host : null;
  } catch { return null; }
}

function cleanAttribution(input = {}, ownHost = "") {
  return {
    visitor_id: cleanVisitorId(input.visitorId),
    utm_source: cleanTag(input.utmSource),
    utm_medium: cleanTag(input.utmMedium),
    utm_campaign: cleanTag(input.utmCampaign),
    referrer_host: cleanReferrerHost(input.referrer, ownHost),
    // A/B test tagging: only well-formed IDs and the two version labels.
    experiment_id: /^[0-9a-f-]{36}$/i.test(String(input.experimentId || "")) ? String(input.experimentId) : null,
    variant: ["a", "b"].includes(input.variant) && /^[0-9a-f-]{36}$/i.test(String(input.experimentId || "")) ? input.variant : null
  };
}

const sourceLabel = row => row?.utm_source || row?.referrer_host || "direct";

// Groups views, signups and verified orders by first-touch source.
function summarizeBySource({ events = [], leads = [], orders = [] }) {
  const sources = new Map(), visitorSource = new Map();
  const bucket = name => { if (!sources.has(name)) sources.set(name, { source: name, views: 0, visitors: new Set(), signups: 0, orders: 0, revenueMinor: 0 }); return sources.get(name); };
  for (const event of [...events].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    if (event.visitor_id && !visitorSource.has(event.visitor_id)) visitorSource.set(event.visitor_id, sourceLabel(event));
    if (event.event_type !== "view") continue;
    const item = bucket(sourceLabel(event));
    item.views++;
    if (event.visitor_id) item.visitors.add(event.visitor_id);
  }
  for (const lead of leads) bucket(sourceLabel(lead)).signups++;
  for (const order of orders) {
    const item = bucket(visitorSource.get(order.client_reference_id) || (order.client_reference_id ? "direct" : "unattributed"));
    item.orders++;
    item.revenueMinor += Number(order.amount_minor || 0) - Number(order.refunded_minor || 0);
  }
  return [...sources.values()].map(item => ({ source: item.source, views: item.views, visitors: item.visitors.size, signups: item.signups, signupRate: item.visitors.size ? Number((item.signups / item.visitors.size).toFixed(4)) : null, orders: item.orders, revenueMinor: item.revenueMinor })).sort((a, b) => b.revenueMinor - a.revenueMinor || b.signups - a.signups || b.views - a.views);
}

module.exports = { cleanAttribution, cleanTag, cleanVisitorId, cleanReferrerHost, summarizeBySource, sourceLabel };
