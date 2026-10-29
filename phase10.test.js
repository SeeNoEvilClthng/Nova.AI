const test = require("node:test");
const assert = require("node:assert/strict");
const { friendlyError, migrationFor } = require("./db-errors");

test("a missing table names the SQL file that creates it", () => {
  const raw = JSON.stringify({ code: "PGRST205", details: null, hint: "Perhaps you meant the table 'public.nova_page_leads'", message: "Could not find the table 'public.nova_payment_connections' in the schema cache" });
  assert.match(friendlyError(raw), /run supabase\/migrations\/20261028_revenue_engine\.sql/);
  assert.doesNotMatch(friendlyError(raw), /PGRST|\{/);
});

test("a missing column points at the column's file, not the table's", () => {
  const raw = JSON.stringify({ code: "PGRST204", message: "Could not find the 'webhook_iv' column of 'nova_payment_connections' in the schema cache" });
  assert.match(friendlyError(raw), /20261101_instant_revenue\.sql/);
  assert.equal(migrationFor("column \"variant\" of relation \"nova_page_events\" does not exist"), "20261103_experiments");
});

test("check-constraint and other database errors become short readable text", () => {
  assert.match(friendlyError(JSON.stringify({ code: "23514", message: "new row for relation \"nova_actions\" violates check constraint \"nova_actions_kind_check\"" })), /20261102_actions\.sql/);
  assert.equal(friendlyError(JSON.stringify({ code: "XX000", message: "boom" })), "Database error: boom");
  assert.equal(friendlyError(JSON.stringify({ code: "PGRST301", message: "JWT expired" })), "Your session expired. Sign in again.");
});

test("ordinary error messages pass through unchanged", () => {
  for (const message of ["Workspace not found", "That doesn't look like a Stripe restricted key. It should start with rk_test_ or rk_live_.", "{not json", ""]) assert.equal(friendlyError(message), message);
});
