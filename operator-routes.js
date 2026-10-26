// HTTP routes and the daily schedule for the Autonomous Operator. Operating
// settings are server-owned: PUT /api/state cannot change the mode, pause
// switch or daily cap, only POST /api/operator/settings can.
const supabase = require("./supabase");
const operator = require("./operator-runtime");
const { normalizeSettings } = require("./operator");
const { assertCanGenerate } = require("./ai-access");
const { runInBackground } = require("./background");

// A run still "running" after 15 minutes has died; show it as failed.
const STALE_MS = 15 * 60_000;

async function handleOperator({ req, res, pathname, requestUrl, sendJson, readBody }) {
  if (!pathname.startsWith("/api/operator/")) return false;
  try {
    if (!supabase.configured()) return sendJson(res, 503, { error: "The operator requires Supabase" }), true;
    const user = await supabase.verifyUser(req);
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? await supabase.getWorkspace(req, workspaceId) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;
    const current = normalizeSettings(workspace.state?.operatingMode || {});

    if (pathname === "/api/operator/settings" && req.method === "POST") {
      const settings = normalizeSettings(input.settings || {}, workspace.state?.operatingMode || {});
      await supabase.saveWorkspace(req, workspace.id, { ...(workspace.state || {}), operatingMode: settings });
      return sendJson(res, 200, { settings }), true;
    }
    if (pathname === "/api/operator/runs" && req.method === "GET") {
      const runs = (await supabase.listOperatorRuns(req, workspace.id)).map(run => run.status === "running" && Date.now() - Date.parse(run.started_at) > STALE_MS ? { ...run, status: "failed", error: run.error || "The cycle stopped before finishing" } : run);
      return sendJson(res, 200, { settings: current, runs }), true;
    }
    if (pathname === "/api/operator/run" && req.method === "POST") {
      if (current.paused) return sendJson(res, 409, { error: "The operator is paused. Resume it first." }), true;
      const latest = await supabase.adminLatestOperatorRun(workspace.id);
      if (latest?.status === "running" && Date.now() - Date.parse(latest.started_at) < STALE_MS) return sendJson(res, 409, { error: "A cycle is already running" }), true;
      await assertCanGenerate(req, user, workspace.id);
      const run = await operator.startRun({ workspaceId: workspace.id, trigger: "manual" });
      if (run.skip) return sendJson(res, 429, { error: run.skip }), true;
      runInBackground(operator.finishCycle(run));
      return sendJson(res, 202, { started: true, runId: run.runId }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Operator request failed" }), true;
  }
}

// Called by the existing daily cron. Runs eligible companies one at a time,
// oldest first, and stops starting new cycles once the time budget is used so
// the function finishes in time; companies not reached run on the next day.
async function runScheduledCycles({ timeBudgetMs = 200_000 } = {}) {
  if (!supabase.configured() || !supabase.hasSecret()) return [];
  const startedAt = Date.now(), results = [];
  for (const workspace of await supabase.adminListOperatorWorkspaces()) {
    if (Date.now() - startedAt > timeBudgetMs) { results.push({ workspaceId: workspace.id, status: "deferred" }); continue; }
    try {
      const latest = await supabase.adminLatestOperatorRun(workspace.id);
      if (latest && Date.now() - Date.parse(latest.started_at) < 20 * 3_600_000) continue;
      const access = await operator.scheduledAccess(workspace);
      if (!access.allowed) {
        const now = new Date().toISOString();
        await supabase.insertOperatorRun({ workspace_id: workspace.id, trigger: "scheduled", mode: normalizeSettings(workspace.state?.operatingMode).mode, status: "skipped", error: access.reason, started_at: now, finished_at: now });
        results.push({ workspaceId: workspace.id, status: "skipped" });
        continue;
      }
      results.push({ workspaceId: workspace.id, ...(await operator.runCycle({ workspaceId: workspace.id, trigger: "scheduled" })) });
    } catch (error) { results.push({ workspaceId: workspace.id, status: "failed", error: String(error.message || "").slice(0, 200) }); }
  }
  return results;
}

module.exports = { handleOperator, runScheduledCycles };
