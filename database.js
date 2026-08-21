const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const path = require("node:path");
const root = path.resolve(process.env.NOVA_APP_ROOT || process.cwd());

const db = new DatabaseSync(path.join(root, "data", "nova.db"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const emptyState = () => ({ plan: null, approved: false, activities: [], evaluation: null });

function ensureDefaultWorkspace() {
  const existing = db.prepare("SELECT id FROM workspaces ORDER BY created_at LIMIT 1").get();
  if (existing) return existing.id;
  return createWorkspace("My first venture").id;
}

function listWorkspaces() {
  ensureDefaultWorkspace();
  return db.prepare("SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM workspaces ORDER BY updated_at DESC").all();
}

function createWorkspace(name) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const cleanName = String(name || "New venture").trim().slice(0, 80) || "New venture";
  db.prepare("INSERT INTO workspaces (id, name, state_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, cleanName, JSON.stringify(emptyState()), now, now);
  return { id, name: cleanName, createdAt: now, updatedAt: now };
}

function getWorkspace(id) {
  const target = id || ensureDefaultWorkspace();
  const row = db.prepare("SELECT id, name, state_json AS stateJson, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?").get(target);
  if (!row) return null;
  return { id: row.id, name: row.name, state: JSON.parse(row.stateJson), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

function saveWorkspace(id, state) {
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE workspaces SET state_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), now, id);
  return Number(result.changes) > 0 ? getWorkspace(id) : null;
}

function renameWorkspace(id, name) {
  const cleanName = String(name || "").trim().slice(0, 80);
  if (!cleanName) throw new Error("Company name is required");
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?").run(cleanName, now, id);
  return Number(result.changes) > 0 ? getWorkspace(id) : null;
}

function deleteWorkspace(id) {
  if (listWorkspaces().length <= 1) throw new Error("Keep at least one company workspace");
  const result = db.prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  return Number(result.changes) > 0;
}

module.exports = { ensureDefaultWorkspace, listWorkspaces, createWorkspace, getWorkspace, saveWorkspace, renameWorkspace, deleteWorkspace };
