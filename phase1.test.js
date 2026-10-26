const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Isolate the local SQLite database and force demo-engine (no model) mode.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { budgetStatus, assertAiBudget, preserveUsage } = require("./ai-budget");
const { usageRows, createUsageLedger } = require("./ai-usage");
const database = require("./database");
const missionAgents = require("./mission-agents");
const app = require("./server");

let server, base;
test.before(async () => { server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test("metered ledger usage overrides a lower client-reported total", () => {
  assert.equal(budgetStatus({ aiUsage: { totalTokens: 0 } }, Infinity, 90000).used, 90000);
  assert.equal(budgetStatus({ aiUsage: { totalTokens: 5000 } }, Infinity, null).used, 5000);
  assert.throws(() => assertAiBudget({ aiUsage: { totalTokens: 0 }, aiBudget: { tokenLimit: 25000 } }, Infinity, 30000), error => error.status === 429);
});

test("saved state can add AI usage but never erase it", () => {
  const existing = { totalTokens: 1200 }, reset = { totalTokens: 0 }, grown = { totalTokens: 1500 };
  assert.equal(preserveUsage(existing, reset), existing);
  assert.equal(preserveUsage(existing, grown), grown);
  assert.equal(preserveUsage(undefined, grown), grown);
});

test("usage rows normalise tokens and mark demo output as fallback", () => {
  const [live, demo] = usageRows([{ id: "gen-1", provider: "OpenAI", model: "gpt", usage: { inputTokens: 10, outputTokens: 5 }, latencyMs: 812.4 }, { provider: "Nova", model: "Demo engine" }], { workspaceId: "w1", operation: "strategy" });
  assert.deepEqual([live.total_tokens, live.latency_ms, live.fallback, live.generation_id], [15, 812, false, "gen-1"]);
  assert.equal(demo.fallback, true);
  assert.ok(demo.generation_id);
});

test("ledger failures never throw and fall back to state", async () => {
  const broken = { configured: () => true, insertAiUsage: async () => { throw new Error("relation does not exist"); }, workspaceAiTokens: async () => { throw new Error("missing function"); } };
  const ledger = createUsageLedger({ supabase: broken, database });
  assert.equal(await ledger.record([{ model: "gpt", usage: { totalTokens: 3 } }], { workspaceId: "w1" }), 0);
  assert.equal(await ledger.workspaceTokens({}, "w1"), null);
});

test("local ledger records each generation once", async () => {
  const workspace = database.createWorkspace("Ledger test"), ledger = createUsageLedger({ supabase: { configured: () => false }, database });
  const contribution = { id: "gen-dup", provider: "OpenAI", model: "gpt", usage: { totalTokens: 40 } };
  await ledger.record(contribution, { workspaceId: workspace.id, operation: "strategy" });
  await ledger.record(contribution, { workspaceId: workspace.id, operation: "strategy" });
  assert.equal(await ledger.workspaceTokens({}, workspace.id), 40);
});

test("static assets send an ETag and answer revalidation with 304", async () => {
  const first = await fetch(`${base}/styles.css`), etag = first.headers.get("etag");
  assert.equal(first.status, 200);
  assert.ok(etag);
  assert.match(first.headers.get("cache-control"), /s-maxage=600/);
  const second = await fetch(`${base}/styles.css`, { headers: { "If-None-Match": etag } });
  assert.equal(second.status, 304);
  const image = await fetch(`${base}/nova-mark.png`);
  assert.equal(image.status, 200);
  assert.ok((await image.arrayBuffer()).byteLength > 1000);
});

test("PUT /api/state cannot lower recorded AI usage", async () => {
  const workspace = database.createWorkspace("Budget test");
  database.saveWorkspace(workspace.id, { ...database.getWorkspace(workspace.id).state, aiUsage: { totalTokens: 9000, events: [] } });
  const response = await fetch(`${base}/api/state?workspace=${workspace.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: null, activities: [], aiUsage: { totalTokens: 0, events: [] } }) });
  assert.equal(response.status, 200);
  assert.equal(database.getWorkspace(workspace.id).state.aiUsage.totalTokens, 9000);
});

test("workforce runs are labelled as drafts, not completed work", async () => {
  const workspace = database.createWorkspace("Workforce test");
  const response = await fetch(`${base}/api/workforce/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: "Validate demand for a bookkeeping service", workspaceId: workspace.id }) });
  const { run } = await response.json();
  assert.equal(response.status, 200);
  assert.ok(run.employees.every(employee => employee.status === "drafted"));
});

test("mission stages return labelled templates without a model", async () => {
  const workspace = database.createWorkspace("Mission test");
  const input = { missionId: "mission-1", workspaceId: workspace.id, company: "Acme", objective: "Book five paid pilot customers this month" };
  const strategy = await missionAgents.runMissionStage("strategy", input);
  assert.equal(strategy.status, "template");
  assert.match(strategy.output, /^Template/);
  const research = await missionAgents.runMissionStage("research", input, [strategy]);
  assert.equal(research.agent, "Research");
});
