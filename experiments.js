// Launch-page A/B tests with honest statistics.
//
// Visitors are split 50/50 by a stable hash of their random visitor ID, so a
// person sees the same version on every visit. Results compare the share of
// visitors who sign up in each version with a two-sided two-proportion z-test.
// To avoid "peeking" false positives, Nova only calls a winner once each
// version has a minimum sample AND the difference is significant at 95%.
const MIN_VISITORS_PER_VARIANT = 100;
const MIN_TOTAL_CONVERSIONS = 10;
const ALPHA = 0.05;

// FNV-1a 32-bit; identical to the copy embedded in the public page script.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
const assignVariant = (visitorId, experimentId) => hash(`${experimentId}:${visitorId}`) % 2 === 0 ? "a" : "b";

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf approximation).
function normalCdf(z) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

function twoProportionTest(conversionsA, visitorsA, conversionsB, visitorsB) {
  if (!visitorsA || !visitorsB) return { z: 0, pValue: 1 };
  const pooled = (conversionsA + conversionsB) / (visitorsA + visitorsB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / visitorsA + 1 / visitorsB));
  if (!se) return { z: 0, pValue: 1 };
  const z = (conversionsB / visitorsB - conversionsA / visitorsA) / se;
  return { z, pValue: 2 * (1 - normalCdf(Math.abs(z))) };
}

// events: page events tagged with this experiment (view / signup with
// visitor_id and variant). orders: verified orders with client_reference_id.
function experimentResults({ events = [], orders = [] }) {
  const variants = { a: { visitors: new Set(), converters: new Set() }, b: { visitors: new Set(), converters: new Set() } }, visitorVariant = new Map();
  for (const event of events) {
    const variant = variants[event.variant];
    if (!variant || !event.visitor_id) continue;
    if (!visitorVariant.has(event.visitor_id)) visitorVariant.set(event.visitor_id, event.variant);
    if (visitorVariant.get(event.visitor_id) !== event.variant) continue; // ignore tampered cross-variant events
    if (event.event_type === "view") variant.visitors.add(event.visitor_id);
    if (event.event_type === "signup") variant.converters.add(event.visitor_id);
  }
  const paid = { a: { orders: 0, revenueMinor: 0 }, b: { orders: 0, revenueMinor: 0 } };
  for (const order of orders) {
    const variant = visitorVariant.get(order.client_reference_id);
    if (!variant) continue;
    paid[variant].orders++;
    paid[variant].revenueMinor += Number(order.amount_minor || 0) - Number(order.refunded_minor || 0);
  }
  const summary = id => {
    const visitors = variants[id].visitors.size, signups = [...variants[id].converters].filter(visitor => variants[id].visitors.has(visitor)).length;
    return { variant: id, visitors, signups, signupRate: visitors ? signups / visitors : 0, ...paid[id] };
  };
  const a = summary("a"), b = summary("b"), test = twoProportionTest(a.signups, a.visitors, b.signups, b.visitors);
  const enoughData = a.visitors >= MIN_VISITORS_PER_VARIANT && b.visitors >= MIN_VISITORS_PER_VARIANT && a.signups + b.signups >= MIN_TOTAL_CONVERSIONS;
  const significant = enoughData && test.pValue < ALPHA;
  const lift = a.signupRate ? (b.signupRate - a.signupRate) / a.signupRate : null;
  let verdict;
  if (!enoughData) verdict = { status: "collecting", winner: null, message: `Collecting data: each version needs at least ${MIN_VISITORS_PER_VARIANT} visitors and the test needs ${MIN_TOTAL_CONVERSIONS} signups before Nova will call a result.` };
  else if (!significant) verdict = { status: "no_difference", winner: null, message: `No clear difference yet (p = ${test.pValue.toFixed(3)}). The gap could still be chance; keep the test running or end it and keep the current headline.` };
  else verdict = { status: "winner", winner: b.signupRate > a.signupRate ? "b" : "a", message: `Version ${b.signupRate > a.signupRate ? "B" : "A"} converts better with 95% confidence (p = ${test.pValue.toFixed(3)}).` };
  return { variants: [a, b], pValue: test.pValue, lift, ...verdict, minimums: { visitorsPerVariant: MIN_VISITORS_PER_VARIANT, totalSignups: MIN_TOTAL_CONVERSIONS } };
}

function cleanVariantCopy({ headline, subhead }) {
  const cleanHeadline = String(headline || "").replace(/\s+/g, " ").trim().slice(0, 130), cleanSubhead = String(subhead || "").replace(/\s+/g, " ").trim().slice(0, 240);
  if (cleanHeadline.length < 8) throw Object.assign(new Error("Write a headline of at least 8 characters for version B"), { status: 400 });
  return { headline: cleanHeadline, subhead: cleanSubhead };
}

module.exports = { hash, assignVariant, normalCdf, twoProportionTest, experimentResults, cleanVariantCopy, MIN_VISITORS_PER_VARIANT, MIN_TOTAL_CONVERSIONS };
