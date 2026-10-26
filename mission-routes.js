// Durable mission and tool-connection routes, served by server.js. These used
// to live in src/index.ts, which Vercel never runs, so they returned 404 in
// production.
const supabase = require("./supabase");
const database = require("./database");
const toolPermissions = require("./tool-permissions");
const { runMissionStage } = require("./mission-agents");
const { createMissionEngine, publicMission } = require("./missions");
const { assertCanGenerate } = require("./ai-access");
const { runInBackground } = require("./background");

const remoteStore = {
  insert: supabase.insertMission, claim: supabase.claimMission, update: supabase.updateMission,
  list: (req, workspaceId) => supabase.listMissions(req, workspaceId),
  get: (req, workspaceId, id) => supabase.getMission(req, workspaceId, id)
};
// Loaded on first use so local-development code never runs in production.
const local = () => require("./mission-store-local").missionStore;
const localStore = {
  insert: row => local().insert(row), claim: (id, leaseMs) => local().claim(id, leaseMs), update: (id, values) => local().update(id, values),
  list: (req, workspaceId) => local().list(workspaceId),
  get: (req, workspaceId, id) => { const mission = local().get(id); return mission?.workspace_id === workspaceId ? mission : null; }
};
const storeFor = () => supabase.configured() ? remoteStore : localStore;
const engineFor = () => createMissionEngine({ store: storeFor(), runStage: runMissionStage });

const connectionCatalog = [
  { id: "github", name: "GitHub", purpose: "Repositories, branches, and pull requests", connectorEnv: "VERCEL_CONNECT_GITHUB_CONNECTOR", capabilities: ["read", "write", "deploy"] },
  { id: "email", name: "Email", purpose: "Draft and send founder-approved messages", connectorEnv: "VERCEL_CONNECT_EMAIL_CONNECTOR", capabilities: ["draft", "send"] },
  { id: "payments", name: "Stripe", purpose: "Revenue visibility, refunds, and spending", connectorEnv: "STRIPE_SECRET_KEY", capabilities: ["read", "refund", "spend"] },
  { id: "marketing", name: "Marketing", purpose: "Draft and publish campaigns", connectorEnv: "VERCEL_CONNECT_MARKETING_CONNECTOR", capabilities: ["draft", "publish"] }
];

async function handleMissions({ req, res, pathname, requestUrl, sendJson, readBody }) {
  if (!pathname.startsWith("/api/durable-missions") && !pathname.startsWith("/api/tool-connections")) return false;
  try {
    const user = supabase.configured() ? await supabase.verifyUser(req) : null;
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? (supabase.configured() ? await supabase.getWorkspace(req, workspaceId) : database.getWorkspace(workspaceId)) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;
    const saveState = state => supabase.configured() ? supabase.saveWorkspace(req, workspace.id, state) : database.saveWorkspace(workspace.id, state);

    if (pathname === "/api/tool-connections" && req.method === "GET") {
      const permissions = toolPermissions.normalizePermissions(workspace.state?.toolPermissions);
      return sendJson(res, 200, { connections: connectionCatalog.map(item => ({ id: item.id, name: item.name, purpose: item.purpose, configured: Boolean(process.env[item.connectorEnv]), capabilities: Object.fromEntries(item.capabilities.map(capability => [capability, permissions[item.id][capability]])) })) }), true;
    }
    if (pathname === "/api/tool-connections/permissions" && req.method === "PATCH") {
      const permissions = toolPermissions.normalizePermissions(input.permissions);
      await saveState({ ...(workspace.state || {}), toolPermissions: permissions });
      return sendJson(res, 200, { permissions }), true;
    }

    const store = storeFor(), engine = engineFor();
    if (pathname === "/api/durable-missions" && req.method === "POST") {
      const objective = String(input.objective || "").trim().slice(0, 1200);
      if (objective.length < 12) return sendJson(res, 400, { error: "Give the durable mission a specific outcome" }), true;
      await assertCanGenerate(req, user, workspace.id);
      const mission = await engine.start({ workspaceId: workspace.id, userId: user?.id, company: workspace.name, objective });
      runInBackground(engine.advance(mission.id), "Mission");
      return sendJson(res, 201, { mission: publicMission(mission) }), true;
    }
    if (pathname === "/api/durable-missions" && req.method === "GET") {
      const missions = await store.list(req, workspace.id);
      // Listing also revives missions whose worker died mid-stage.
      for (const mission of missions.filter(engine.needsResume)) runInBackground(engine.advance(mission.id), "Mission resume");
      return sendJson(res, 200, { missions: missions.map(publicMission) }), true;
    }
    const action = pathname.match(/^\/api\/durable-missions\/([^/]+)\/(decision|retry)$/);
    if (action && req.method === "POST") {
      const mission = await store.get(req, workspace.id, decodeURIComponent(action[1]));
      if (!mission) return sendJson(res, 404, { error: "Mission not found" }), true;
      if (action[2] === "decision") {
        const updated = await engine.decide({ mission, approved: input.approved, comment: input.comment });
        if (updated.status === "executing") runInBackground(engine.advance(mission.id), "Mission");
        return sendJson(res, 200, { resumed: updated.status === "executing", mission: publicMission(updated) }), true;
      }
      await assertCanGenerate(req, user, workspace.id);
      const updated = await engine.retry(mission);
      runInBackground(engine.advance(mission.id), "Mission retry");
      return sendJson(res, 200, { mission: publicMission(updated) }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "Mission request failed" }), true;
  }
}

// Daily cron safety net for missions nobody has looked at since they stalled.
async function resumeStalledMissions() {
  if (!supabase.configured() || !supabase.hasSecret()) return [];
  const engine = engineFor(), stalled = (await supabase.adminListActiveMissions()).filter(engine.needsResume), results = [];
  for (const mission of stalled.slice(0, 10)) results.push({ id: mission.id, ...(await engine.advance(mission.id)) });
  return results;
}

module.exports = { handleMissions, resumeStalledMissions };
