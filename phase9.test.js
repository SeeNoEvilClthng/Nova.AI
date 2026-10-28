const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { assignVariant, twoProportionTest, experimentResults, cleanVariantCopy } = require("./experiments");
const { cleanAttribution } = require("./attribution");
const { KINDS } = require("./actions");

const EXPERIMENT = "11111111-2222-3333-4444-555555555555";

// Renders the real public page template from server.js.
function renderPage(options) {
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  const grab = name => { const start = src.indexOf(`function ${name}(`); let depth = 0, i = src.indexOf(") {", start) + 2; for (; i < src.length; i++) { if (src[i] === "{") depth++; else if (src[i] === "}") { depth--; if (!depth) break; } } return src.slice(start, i + 1); };
  const escapeHtml = eval(`(${grab("escapeHtml")})`);
  const publicPageHtml = eval(`(${grab("publicPageHtml")})`);
  return publicPageHtml({ title: "Acme", slug: "acme-1", snapshot: { headline: "Version A headline", subhead: "A sub", cta: "Join", trust: "T", eyebrow: "E" } }, "", options);
}

test("visitors split about 50/50 and always see the same version", () => {
  const counts = { a: 0, b: 0 };
  for (let i = 0; i < 10000; i++) counts[assignVariant(`visitor-${i}`, EXPERIMENT)]++;
  assert.ok(Math.abs(counts.a - 5000) < 250, `split was ${counts.a}/${counts.b}`);
  assert.equal(assignVariant("visitor-42", EXPERIMENT), assignVariant("visitor-42", EXPERIMENT));
});

test("the public page assigns the same version as the server", () => {
  const html = renderPage({ experiment: { id: EXPERIMENT, variants: { b: { headline: "Version B </script><b>", subhead: "B sub" } } } });
  assert.ok(!html.includes("Version B </script>"), "headline must be escaped inside the script");
  const early = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  for (const visitorId of ["visitor-aaaa1111", "visitor-bbbb2222", "visitor-cccc3333", "visitor-dddd4444"]) {
    const elements = { "nova-h": { textContent: "A" }, "nova-s": { textContent: "A" } }, storage = { nova_ft: JSON.stringify({ visitorId }) };
    const sandbox = { window: {}, localStorage: { getItem: key => storage[key] || null, setItem: () => {} }, location: { search: "" }, document: { referrer: "", getElementById: id => elements[id] }, URLSearchParams, crypto: {}, JSON, Math, String, Date };
    vm.runInNewContext(early, sandbox);
    const variant = assignVariant(visitorId, EXPERIMENT);
    assert.equal(sandbox.window.__nova.variant, variant);
    assert.equal(sandbox.window.__nova.experimentId, EXPERIMENT);
    assert.equal(elements["nova-h"].textContent, variant === "b" ? "Version B </script><b>" : "A");
  }
});

test("pages without a test render normally and their scripts compile", () => {
  const html = renderPage({});
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
  assert.match(html, /<h1 id="nova-h">Version A headline<\/h1>/);
});

test("two-proportion test matches the textbook value", () => {
  const { z, pValue } = twoProportionTest(100, 1000, 130, 1000);
  assert.ok(Math.abs(z - 2.1027) < 0.001, `z=${z}`);
  assert.ok(Math.abs(pValue - 0.0355) < 0.002, `p=${pValue}`);
  assert.equal(twoProportionTest(0, 0, 1, 10).pValue, 1);
});

function events({ visitorsA, signupsA, visitorsB, signupsB }) {
  const rows = [];
  for (let i = 0; i < visitorsA; i++) { rows.push({ event_type: "view", visitor_id: `a-${i}`, variant: "a" }); if (i < signupsA) rows.push({ event_type: "signup", visitor_id: `a-${i}`, variant: "a" }); }
  for (let i = 0; i < visitorsB; i++) { rows.push({ event_type: "view", visitor_id: `b-${i}`, variant: "b" }); if (i < signupsB) rows.push({ event_type: "signup", visitor_id: `b-${i}`, variant: "b" }); }
  return rows;
}

test("no winner is called before the minimum sample, however big the gap", () => {
  const results = experimentResults({ events: events({ visitorsA: 40, signupsA: 1, visitorsB: 40, signupsB: 12 }) });
  assert.equal(results.status, "collecting");
  assert.equal(results.winner, null);
});

test("a real difference with enough data names the winner", () => {
  const results = experimentResults({ events: events({ visitorsA: 1000, signupsA: 100, visitorsB: 1000, signupsB: 140 }) });
  assert.equal(results.status, "winner");
  assert.equal(results.winner, "b");
  assert.ok(results.lift > 0.39 && results.lift < 0.41);
});

test("a small gap with enough data is reported as no clear difference", () => {
  assert.equal(experimentResults({ events: events({ visitorsA: 500, signupsA: 50, visitorsB: 500, signupsB: 55 }) }).status, "no_difference");
});

test("tampered events can't switch a visitor's version, and orders follow the version", () => {
  const rows = [{ event_type: "view", visitor_id: "v1", variant: "a" }, { event_type: "signup", visitor_id: "v1", variant: "b" }, { event_type: "signup", visitor_id: "v1", variant: "a" }];
  const results = experimentResults({ events: rows, orders: [{ client_reference_id: "v1", amount_minor: 9900 }] });
  assert.deepEqual(results.variants.map(row => [row.variant, row.visitors, row.signups, row.orders]), [["a", 1, 1, 1], ["b", 0, 0, 0]]);
});

test("variant copy, attribution tags and action payloads are validated", () => {
  assert.throws(() => cleanVariantCopy({ headline: "Hi" }), /at least 8/);
  assert.deepEqual(cleanVariantCopy({ headline: "  A   better\nheadline ", subhead: "x" }), { headline: "A better headline", subhead: "x" });
  assert.deepEqual([cleanAttribution({ experimentId: EXPERIMENT, variant: "b" }).variant, cleanAttribution({ experimentId: "bad", variant: "b" }).variant, cleanAttribution({ experimentId: EXPERIMENT, variant: "c" }).variant], ["b", null, null]);
  assert.throws(() => KINDS.page_headline_update.clean({ experimentId: EXPERIMENT, variant: "z" }), /test and a version/);
  assert.equal(KINDS.page_headline_update.clean({ experimentId: EXPERIMENT, variant: "b", headline: "New" }).variant, "b");
});

test("A/B routes load in the deployed server", async () => {
  const app = require("./server"), server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/experiments?workspace=x`)).status, 503);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).status, "ok");
  } finally { server.close(); }
});
