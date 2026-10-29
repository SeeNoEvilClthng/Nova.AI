// Turns raw Supabase/PostgREST error bodies (JSON text) into messages a
// founder can act on. A missing table or column almost always means one of
// the SQL files in supabase/migrations has not been run yet, so name it.
const MIGRATIONS = [
  ["20261026_ai_usage_ledger", ["nova_ai_usage_events", "nova_workspace_ai_tokens"]],
  ["20261027_rate_limits_and_visitor_writes", ["nova_rate_limits", "nova_rate_limit_hit"]],
  ["20261028_revenue_engine", ["nova_payment_connections", "nova_orders"]],
  ["20261029_operator_runs", ["nova_operator_runs"]],
  ["20261030_missions", ["nova_missions"]],
  ["20261031_growth", ["nova_email_sends", "client_reference_id", "last_contacted_at", "unsubscribed_at", "visitor_id", "utm_source", "utm_medium", "utm_campaign", "referrer_host"]],
  ["20261101_instant_revenue", ["webhook_endpoint_id", "webhook_secret_enc", "webhook_iv", "webhook_tag"]],
  ["20261102_actions", ["nova_actions"]],
  ["20261103_experiments", ["nova_experiments", "experiment_id", "variant"]]
];
const MISSING = new Set(["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"]);

function parse(text) {
  if (typeof text !== "string" || !/^\s*\{/.test(text)) return null;
  try { const value = JSON.parse(text); return value && typeof value === "object" && (value.code || value.message) ? value : null; } catch { return null; }
}

function migrationFor(text) {
  // Columns are checked before tables so "webhook_iv of nova_payment_connections" points at the column's file.
  const names = MIGRATIONS.flatMap(([file, items]) => items.map(name => [file, name]));
  const columnFirst = [...names.filter(([, name]) => !name.startsWith("nova_")), ...names.filter(([, name]) => name.startsWith("nova_"))];
  return columnFirst.find(([, name]) => new RegExp(`\\b${name}\\b`).test(text))?.[0] || null;
}

function friendlyError(message) {
  const error = parse(message);
  if (!error) return message;
  const text = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`;
  if (MISSING.has(String(error.code))) {
    const file = migrationFor(String(error.message || ""));
    return file
      ? `Nova's database is missing a setup step. In Supabase → SQL Editor, run supabase/migrations/${file}.sql, then try again.`
      : "Nova's database is missing a setup step. Run the latest SQL files from supabase/migrations in Supabase → SQL Editor, then try again.";
  }
  if (String(error.code) === "23514") {
    const file = migrationFor(text);
    return file ? `The database rejected this change. In Supabase → SQL Editor, run supabase/migrations/${file}.sql, then try again.` : "The database rejected this change because a value was not allowed.";
  }
  if (/JWT|token/i.test(String(error.message))) return "Your session expired. Sign in again.";
  return `Database error: ${String(error.message || "request failed").slice(0, 200)}`;
}

module.exports = { friendlyError, migrationFor };
