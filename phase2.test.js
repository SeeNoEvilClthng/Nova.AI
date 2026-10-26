const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "NOVA_DISABLE_BUNDLING"]) delete process.env[key];

const { createBundler, joinCss } = require("./asset-bundler");
const { createRateLimiter } = require("./rate-limit");
const app = require("./server");

let server, base;
test.before(async () => { server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

function memoryBundler(files) {
  const emitted = new Map();
  const bundleHtml = createBundler({ resolve: href => files[href] !== undefined ? href : null, read: href => Buffer.from(files[href]), emit: (route, body) => emitted.set(route, body.toString()) });
  return { bundleHtml, emitted };
}

test("consecutive local stylesheets and scripts collapse into hashed bundles", () => {
  const { bundleHtml, emitted } = memoryBundler({ "a.css": "a{}", "b.css": "b{}", "a.js": "let a=1", "b.js": "let b=a+1" });
  const html = bundleHtml('<link rel="stylesheet" href="a.css">\n<link rel="stylesheet" href="b.css">\n<p></p><script src="a.js"></script><script src="b.js"></script>');
  assert.match(html, /^<link rel="stylesheet" href="\/bundle-[\w-]{16}\.css">\n<p><\/p><script src="\/bundle-[\w-]{16}\.js"><\/script>$/);
  const js = [...emitted].find(([route]) => route.endsWith(".js"))[1];
  assert.ok(js.indexOf("let a=1") < js.indexOf("let b=a+1"));
});

test("runs containing a non-local file are left unchanged", () => {
  const { bundleHtml, emitted } = memoryBundler({ "a.css": "a{}" });
  const html = '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="https://cdn.example/x.css">';
  assert.equal(bundleHtml(html), html);
  assert.equal(emitted.size, 0);
});

test("CSS @import rules are hoisted so later-file fonts still load", () => {
  const css = joinCss(["body{color:red}", "@import url('https://fonts.example/a.css');\n.x{}"]);
  assert.ok(css.startsWith("@import url('https://fonts.example/a.css');"));
  assert.match(css, /body\{color:red\}[\s\S]*\.x\{\}/);
});

test("the dashboard shell loads two immutable bundles", async () => {
  const html = await (await fetch(`${base}/`)).text();
  const css = html.match(/href="(\/bundle-[\w-]{16}\.css)"/g), js = html.match(/src="(\/bundle-[\w-]{16}\.js)"/g);
  assert.equal(css.length, 1);
  assert.equal(js.length, 1);
  assert.doesNotMatch(html, /href="styles\.css"|src="app\.js"/);
  const route = js[0].slice(5, -1), bundle = await fetch(`${base}${route}`), body = await bundle.text();
  assert.equal(bundle.status, 200);
  assert.equal(bundle.headers.get("cache-control"), "public, max-age=31536000, immutable");
  assert.ok(body.includes("function recordUsage") && body.includes("renderDurableMissions"));
  assert.equal((await fetch(`${base}/app.js`)).status, 200); // originals stay available
});

test("shared limiter stores an HMAC, not the client IP, and enforces the database verdict", async () => {
  const calls = [];
  const limiter = createRateLimiter({ supabase: { configured: () => true, hasSecret: () => true, rateLimitHit: async (key, max, seconds) => { calls.push({ key, max, seconds }); return calls.length > 2; } }, secret: () => "s" });
  const req = { headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, socket: {} };
  assert.equal(await limiter.limited(req, "waitlist", 2), false);
  assert.equal(await limiter.limited(req, "waitlist", 2), false);
  assert.equal(await limiter.limited(req, "waitlist", 2), true);
  assert.equal(calls[0].seconds, 3600);
  assert.ok(calls[0].key.startsWith("waitlist:") && !calls[0].key.includes("203.0.113.9"));
});

test("limiter falls back to per-instance buckets when the database fails", async () => {
  const limiter = createRateLimiter({ supabase: { configured: () => true, hasSecret: () => true, rateLimitHit: async () => { throw new Error("function does not exist"); } } });
  const req = { headers: { "x-real-ip": "198.51.100.4" }, socket: {} };
  assert.equal(await limiter.limited(req, "views", 1), false);
  assert.equal(await limiter.limited(req, "views", 1), true);
  assert.equal(await limiter.limited({ headers: { "x-real-ip": "198.51.100.5" }, socket: {} }, "views", 1), false);
});
