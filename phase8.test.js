const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-test-"));
fs.mkdirSync(path.join(root, "data"));
process.env.NOVA_APP_ROOT = root;
for (const key of ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY", "AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN", "RESEND_API_KEY", "NOVA_EMAIL_FROM"]) delete process.env[key];

const { createActionEngine, publicAction, validActionReceipt } = require("./actions");

function memoryStore() {
  const rows = new Map(); let next = 0;
  return {
    rows,
    insert: async row => { const saved = { id: `a${++next}`, created_at: "t", ...structuredClone(row) }; rows.set(saved.id, saved); return structuredClone(saved); },
    findOpen: async (workspaceId, key) => [...rows.values()].find(row => row.workspace_id === workspaceId && row.dedupe_key === key && ["proposed", "approved", "executing"].includes(row.status)) || null,
    transition: async (id, from, values) => { const row = rows.get(id); if (!row || row.status !== from) return null; Object.assign(row, structuredClone(values)); return structuredClone(row); }
  };
}
const followUp = { subject: "Quick question", body: "Thanks for signing up. What made you interested?", leadCount: 3 };

test("proposals are cleaned and deduplicated while open", async () => {
  const engine = createActionEngine({ store: memoryStore(), executors: {} });
  const first = await engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: { ...followUp, subject: "Hi\nBcc: x" }, dedupeKey: "lead_followup" });
  assert.equal(first.created, true);
  assert.equal(first.action.payload.subject, "Hi Bcc: x");
  assert.equal((await engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: followUp, dedupeKey: "lead_followup" })).created, false);
  assert.equal((await engine.propose({ workspaceId: "w2", kind: "lead_followup", payload: followUp, dedupeKey: "lead_followup" })).created, true);
  await assert.rejects(engine.propose({ workspaceId: "w1", kind: "wire_money", payload: {} }), /Unknown action kind/);
  await assert.rejects(engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: { subject: "Hi", body: "short" } }), /subject and a message/);
});

test("nothing runs without approval, and an approved action runs exactly once", async () => {
  const store = memoryStore(); let runs = 0;
  const engine = createActionEngine({ store, executors: { lead_followup: async () => { runs++; await new Promise(resolve => setTimeout(resolve, 5)); return { provider: "resend", sent: 3, failed: 0, messageIds: ["m1", "m2", "m3"] }; } } });
  const { action } = await engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: followUp });
  assert.deepEqual(await engine.execute(action.id), { executed: false });
  assert.equal(runs, 0);
  const approved = await engine.decide({ action, approved: true, approverEmail: "founder@acme.test" });
  assert.equal(approved.approver_email, "founder@acme.test");
  await assert.rejects(engine.decide({ action: approved, approved: true }), /no longer waiting/);
  const [first, second] = await Promise.all([engine.execute(action.id), engine.execute(action.id)]);
  assert.equal(runs, 1);
  assert.deepEqual([first.executed, second.executed].sort(), [false, true]);
  const done = store.rows.get(action.id);
  assert.equal(done.status, "succeeded");
  assert.ok(validActionReceipt(done));
  assert.equal(publicAction(done).receiptVerified, true);
});

test("receipts detect edited evidence", async () => {
  const store = memoryStore();
  const engine = createActionEngine({ store, executors: { offer_go_live: async () => ({ provider: "stripe", paymentLinkId: "plink_1", url: "https://buy.stripe.com/x" }) } });
  const { action } = await engine.propose({ workspaceId: "w1", kind: "offer_go_live", payload: { offerId: "o1", name: "Pilot", price: 149 } });
  await engine.decide({ action, approved: true });
  await engine.execute(action.id);
  const row = store.rows.get(action.id);
  assert.ok(validActionReceipt(row));
  assert.equal(validActionReceipt({ ...row, evidence: { ...row.evidence, url: "https://evil.example" } }), false);
  assert.equal(validActionReceipt({ ...row, status: "failed" }), false);
});

test("a failed action records the error and can be retried", async () => {
  const store = memoryStore(); let attempts = 0;
  const engine = createActionEngine({ store, executors: { lead_followup: async () => { attempts++; if (attempts === 1) throw new Error("Email provider rejected the message"); return { sent: 3 }; } } });
  const { action } = await engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: followUp });
  await engine.decide({ action, approved: true });
  assert.equal((await engine.execute(action.id)).status, "failed");
  assert.match(store.rows.get(action.id).error, /rejected/);
  await assert.rejects(engine.retry({ id: "other", status: "proposed" }), /Only failed/);
  await engine.retry(store.rows.get(action.id));
  assert.equal((await engine.execute(action.id)).status, "succeeded");
});

test("rejected actions never run", async () => {
  const store = memoryStore(); let runs = 0;
  const engine = createActionEngine({ store, executors: { lead_followup: async () => { runs++; return {}; } } });
  const { action } = await engine.propose({ workspaceId: "w1", kind: "lead_followup", payload: followUp });
  assert.equal((await engine.decide({ action, approved: false })).status, "rejected");
  await engine.execute(action.id);
  assert.equal(runs, 0);
});

test("the operator proposes concrete actions from real state", async () => {
  process.env.RESEND_API_KEY = "re_test"; process.env.NOVA_EMAIL_FROM = "Acme <hi@acme.test>";
  const supabase = require("./supabase"), saved = {}, inserted = [];
  const overrides = {
    adminGetWorkspace: async () => ({ id: "w1", name: "Acme", state: { plan: { name: "Acme" }, offers: [{ id: "o1", name: "Pilot", price: 149, currency: "USD", billing: "one_time", status: "draft" }, { id: "o2", name: "Live one", price: 99, checkout: { url: "https://buy.stripe.com/y" }, status: "active" }] } }),
    adminGetOwnerPage: async () => ({ id: "p1", slug: "acme", published: true }),
    findOpenAction: async () => null,
    insertAction: async row => { inserted.push(row); return { id: `a${inserted.length}`, ...row }; }
  };
  for (const [key, value] of Object.entries(overrides)) { saved[key] = supabase[key]; supabase[key] = value; }
  try {
    const { proposeOperatorActions } = require("./action-routes");
    const result = await proposeOperatorActions({ workspaceId: "w1", userId: "u1", metrics: { funnel: { newLeads: 4 }, revenue: { stripeConnected: true } } });
    assert.equal(result.created, 2);
    assert.deepEqual(inserted.map(row => [row.kind, row.status, row.dedupe_key]), [["lead_followup", "proposed", "lead_followup"], ["offer_go_live", "proposed", "offer_go_live:o1"]]);
    assert.equal(inserted[0].payload.leadCount, 4);
    assert.ok(inserted[0].payload.body.length > 20);
  } finally {
    for (const [key, value] of Object.entries(saved)) supabase[key] = value;
    delete process.env.RESEND_API_KEY; delete process.env.NOVA_EMAIL_FROM;
  }
});

test("operator cycles survive a failing action proposer", async () => {
  const { createOperator } = require("./operator");
  const runs = [];
  const supabase = { adminGetWorkspace: async id => ({ id, user_id: "u1", name: "Acme", state: { operatingMode: { mode: "supervised", paused: false } } }), adminTokensSince: async () => 0, insertOperatorRun: async row => { runs.push(row); return { id: "r1" }; }, updateOperatorRun: async (id, values) => runs.push(values), getPaymentConnection: async () => null, adminPageMetrics: async () => ({}), adminValidationCount: async () => 0, adminListOrders: async () => [] };
  const operator = createOperator({ supabase, router: require("./router"), ledger: { record: async () => {} }, syncRevenue: async () => ({}), billingEnabled: () => false, planRules: {}, assertAiBudget: () => {}, proposeActions: async () => { throw new Error("database offline"); } });
  assert.equal((await operator.runCycle({ workspaceId: "w1", trigger: "manual" })).status, "completed");
  assert.match(runs.at(-1).brief.warnings.join(" "), /Action proposals skipped: database offline/);
});

test("the Action Center routes load in the deployed server", async () => {
  const app = require("./server"), server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/api/actions?workspace=x`)).status, 503);
    assert.equal((await (await fetch(`${base}/api/health`)).json()).status, "ok");
  } finally { server.close(); }
});
