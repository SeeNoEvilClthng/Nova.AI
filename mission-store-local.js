// Local-development (SQLite) mission store with the same contract as the
// Supabase functions. The table is created on first use, not at startup, so
// this file can never affect how the server boots.
const { randomUUID } = require("node:crypto");
const { db } = require("./database");

let ready = false;
function ensureTable() {
  if (ready) return;
  db.exec(`CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, user_id TEXT, company TEXT NOT NULL, objective TEXT NOT NULL,
    status TEXT NOT NULL, resume_status TEXT, steps_json TEXT NOT NULL, decision_json TEXT, error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0, locked_until TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
  ready = true;
}

function missionRow(row) {
  if (!row) return null;
  const { steps_json: steps, decision_json: decision, ...rest } = row;
  return { ...rest, steps: JSON.parse(steps || "[]"), decision: decision ? JSON.parse(decision) : null };
}
const COLUMNS = ["user_id", "company", "objective", "status", "resume_status", "error", "attempts", "locked_until", "created_at", "updated_at"];

const missionStore = {
  insert(row) {
    ensureTable();
    const id = randomUUID();
    db.prepare("INSERT INTO missions (id, workspace_id, user_id, company, objective, status, steps_json, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, row.workspace_id, row.user_id ?? null, row.company, row.objective, row.status, JSON.stringify(row.steps || []), row.attempts || 0, row.created_at, row.updated_at);
    return missionStore.get(id);
  },
  get(id) { ensureTable(); return missionRow(db.prepare("SELECT * FROM missions WHERE id = ?").get(id)); },
  list(workspaceId) { ensureTable(); return db.prepare("SELECT * FROM missions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 30").all(workspaceId).map(missionRow); },
  claim(id, leaseMs) {
    ensureTable();
    const now = new Date().toISOString(), until = new Date(Date.now() + leaseMs).toISOString();
    const result = db.prepare("UPDATE missions SET locked_until = ? WHERE id = ? AND (locked_until IS NULL OR locked_until < ?)").run(until, id, now);
    return Number(result.changes) ? missionStore.get(id) : null;
  },
  update(id, values) {
    ensureTable();
    const sets = [], params = [];
    for (const [key, value] of Object.entries(values)) {
      if (key === "steps") { sets.push("steps_json = ?"); params.push(JSON.stringify(value)); }
      else if (key === "decision") { sets.push("decision_json = ?"); params.push(JSON.stringify(value)); }
      else if (COLUMNS.includes(key)) { sets.push(`${key} = ?`); params.push(value ?? null); }
    }
    if (sets.length) db.prepare(`UPDATE missions SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  }
};

module.exports = { missionStore };
