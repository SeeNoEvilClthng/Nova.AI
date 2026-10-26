// Rate limits shared by every serverless instance. The previous in-memory
// buckets were per instance, so on Vercel each cold instance started with a
// fresh allowance. Counters now live in Postgres (nova_rate_limit_hit) and the
// in-memory buckets remain only as a fallback when the database is unreachable.
const crypto = require("node:crypto");

function clientIp(req) {
  return String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
}

function createRateLimiter({ supabase, secret = () => "", now = () => Date.now() }) {
  const buckets = new Map();
  let warned = false;

  function localHit(key, limit, windowMs) {
    const time = now(), recent = (buckets.get(key) || []).filter(stamp => time - stamp < windowMs);
    if (recent.length >= limit) { buckets.set(key, recent); return true; }
    recent.push(time); buckets.set(key, recent);
    // Prune idle keys so a long-lived instance does not grow without bound.
    if (buckets.size > 5000) for (const [bucket, stamps] of buckets) if (!stamps.some(stamp => time - stamp < windowMs)) buckets.delete(bucket);
    return false;
  }

  // Raw IP addresses are never stored: buckets are keyed by an HMAC.
  function bucketKey(scope, identity) {
    return `${scope}:${crypto.createHmac("sha256", secret() || "nova-rate-limit").update(identity).digest("base64url").slice(0, 32)}`;
  }

  // identity defaults to the client IP; pass a user ID for signed-in routes.
  async function limited(req, scope, limit, windowMs = 3_600_000, identity = clientIp(req)) {
    const key = bucketKey(scope, identity);
    if (supabase.configured() && supabase.hasSecret()) {
      try { return await supabase.rateLimitHit(key, limit, Math.ceil(windowMs / 1000)); }
      catch (error) { if (!warned) console.warn("Shared rate limiter unavailable; using per-instance limits:", error.message); warned = true; }
    }
    return localHit(key, limit, windowMs);
  }

  return { limited, clientIp };
}

module.exports = { createRateLimiter, clientIp };
