const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"]) delete process.env[key];

const { createMissionEngine, publicMission } = require("./missions");
const database = require("./database");

function memoryStore() {
  const rows = new Map(); let next = 0;
  return {
    rows,
    insert: async row => { const saved = { id: `m${++next}`, ...row }; rows.set(saved.id, saved); return saved; },
    claim: async (id, leaseMs) => { const row = rows.get(id); if (!row || (row.locked_until && Date.parse(row.locked_until) > Date.now())) return null; row.locked_until = new Date(Date.now() + leaseMs).toISOString(); return structuredClone(row); },
    update: async (id, values) => Object.assign(rows.get(id), structuredClone(values))
  };
}
const AGENT = { strategy: "Strategy", research: "Research", build: "Builder", review: "Reviewer" };
function stages(failures = {}) {
  const calls = [];
  return { calls, runStage: async stage => { calls.push(stage); if (failures[stage]) { failures[stage]--; throw new Error(`${stage} model timeout`); } return { agent: AGENT[stage], status: "drafted", output: `${stage} done` }; } };
}

test("a mission drafts, waits for approval, then completes with a prepared-not-executed step", async () => {
  const store = memoryStore(), { runStage, calls } = stages(), engine = createMissionEngine({ store, runStage });
  const mission = await engine.start({ workspaceId: "w1", userId: "u1", company: "Acme", objective: "Sign three paying pilot clinics" });
  assert.equal((await engine.advance(mission.id)).status, "awaiting_approval");
  assert.deepEqual(store.rows.get(mission.id).steps.map(step => step.agent), ["Strategy", "Research", "Builder"]);
  assert.equal((await engine.advance(mission.id)).advanced, false);
  const approved = await engine.decide({ mission: store.rows.get(mission.id), approved: true, comment: "Go" });
  assert.equal(approved.status, "executing");
  assert.equal((await engine.advance(mission.id)).status, "completed");
  const steps = store.rows.get(mission.id).steps;
  assert.deepEqual(steps.map(step => step.agent), ["Strategy", "Research", "Builder", "Operations", "Reviewer"]);
  assert.match(steps[3].output, /nothing was published, sent, or charged/);
  assert.deepEqual(calls, ["strategy", "research", "build", "review"]);
  assert.equal(publicMission(store.rows.get(mission.id)).status, "completed");
});

test("rejection ends the mission and decisions are only accepted at the checkpoint", async () => {
  const store = memoryStore(), engine = createMissionEngine({ store, runStage: stages().runStage });
  const mission = await engine.start({ workspaceId: "w1", company: "Acme", objective: "Sign three paying pilot clinics" });
  await assert.rejects(engine.decide({ mission: store.rows.get(mission.id), approved: true }), /not waiting/);
  await engine.advance(mission.id);
  assert.equal((await engine.decide({ mission: store.rows.get(mission.id), approved: false })).status, "rejected");
});

test("a crash resumes at the next unfinished step without redoing saved ones", async () => {
  const store = memoryStore(), { runStage, calls } = stages({ research: 1 }), engine = createMissionEngine({ store, runStage });
  const mission = await engine.start({ workspaceId: "w1", company: "Acme", objective: "Sign three paying pilot clinics" });
  const first = await engine.advance(mission.id);
  assert.equal(first.status, "running");
  assert.match(store.rows.get(mission.id).error, /research model timeout/);
  assert.deepEqual(store.rows.get(mission.id).steps.map(step => step.agent), ["Strategy"]);
  await engine.advance(mission.id);
  assert.deepEqual(calls, ["strategy", "research", "research", "build"]);
  assert.equal(store.rows.get(mission.id).status, "awaiting_approval");
});

test("three failures mark the mission failed, and retry resumes it", async () => {
  const store = memoryStore(), engine = createMissionEngine({ store, runStage: stages({ strategy: 3 }).runStage });
  const mission = await engine.start({ workspaceId: "w1", company: "Acme", objective: "Sign three paying pilot clinics" });
  for (let i = 0; i < 3; i++) await engine.advance(mission.id);
  assert.equal(store.rows.get(mission.id).status, "failed");
  assert.equal(publicMission(store.rows.get(mission.id)).attempts, 3);
  await engine.retry(store.rows.get(mission.id));
  assert.equal((await engine.advance(mission.id)).status, "awaiting_approval");
});

test("only one worker can hold a mission's lease", async () => {
  const store = memoryStore();
  let release, gate = new Promise(resolve => { release = resolve; });
  const slow = createMissionEngine({ store, runStage: async stage => { await gate; return { agent: AGENT[stage], status: "drafted", output: "x" }; } });
  const mission = await slow.start({ workspaceId: "w1", company: "Acme", objective: "Sign three paying pilot clinics" });
  const running = slow.advance(mission.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await slow.advance(mission.id)).advanced, false);
  release();
  await running;
});

test("stalled missions without a live lease are resumed", () => {
  const now = Date.parse("2026-10-30T12:00:00Z"), engine = createMissionEngine({ store: memoryStore(), runStage: async () => ({}), now: () => now });
  assert.equal(engine.needsResume({ status: "running", updated_at: "2026-10-30T11:50:00Z" }), true);
  assert.equal(engine.needsResume({ status: "running", updated_at: "2026-10-30T11:59:30Z" }), false);
  assert.equal(engine.needsResume({ status: "running", updated_at: "2026-10-30T11:50:00Z", locked_until: "2026-10-30T12:03:00Z" }), false);
  assert.equal(engine.needsResume({ status: "awaiting_approval", updated_at: "2026-10-30T10:00:00Z" }), false);
});

test("the local SQLite store saves steps and enforces the lease", () => {
  const store = require("./mission-store-local").missionStore, workspace = database.createWorkspace("Lease test");
  const mission = store.insert({ workspace_id: workspace.id, company: "Acme", objective: "Sign three paying pilot clinics", status: "running", steps: [], created_at: "t", updated_at: "t" });
  assert.ok(store.claim(mission.id, 60_000));
  assert.equal(store.claim(mission.id, 60_000), null);
  store.update(mission.id, { steps: [{ agent: "Strategy" }], locked_until: null, status: "awaiting_approval" });
  const saved = store.get(mission.id);
  assert.deepEqual([saved.status, saved.steps[0].agent], ["awaiting_approval", "Strategy"]);
});

test("missions run end to end over HTTP in the server Vercel deploys", async () => {
  const app = require("./server"), server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`, workspace = database.createWorkspace("HTTP missions");
  const post = (url, body) => fetch(`${base}${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id, ...body }) });
  const waitFor = async predicate => { for (let i = 0; i < 50; i++) { const { missions } = await (await fetch(`${base}/api/durable-missions?workspace=${workspace.id}`)).json(); if (predicate(missions[0])) return missions[0]; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error("timed out"); };
  try {
    const created = await post("/api/durable-missions", { objective: "Sign three paying pilot clinics this month" });
    assert.equal(created.status, 201);
    const id = (await created.json()).mission.id;
    const waiting = await waitFor(mission => mission.stage === "awaiting_approval");
    assert.deepEqual(waiting.steps.map(step => step.status), ["template", "template", "template"]);
    assert.equal((await post(`/api/durable-missions/${id}/decision`, { approved: true })).status, 200);
    const done = await waitFor(mission => mission.status === "completed");
    assert.equal(done.steps.at(-1).agent, "Reviewer");
    const connections = await (await fetch(`${base}/api/tool-connections?workspace=${workspace.id}`)).json();
    assert.ok(connections.connections.some(item => item.id === "github"));
  } finally { server.close(); }
});
