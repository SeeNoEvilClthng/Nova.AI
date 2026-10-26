// Durable missions as a saved state machine. Runs inside server.js, which is
// what Vercel deploys (the earlier Workflow DevKit version lived in
// src/index.ts and was never reachable in production).
//
//   running ──(strategy, research, build)──▶ awaiting_approval
//   awaiting_approval ──approve──▶ executing ──(prepare, review)──▶ completed
//   awaiting_approval ──reject──▶ rejected
//   any stage failing 3 times ──▶ failed (founder can retry)
//
// Each step's result is saved the moment it finishes, so a crash or timeout
// resumes at the next unfinished step. A short lease stops two server
// instances from working on the same mission at once.
const PRE_APPROVAL = [["strategy", "Strategy"], ["research", "Research"], ["build", "Builder"]];
const LEASE_MS = 5 * 60_000;
const STALE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;

function cleanStep(step) {
  return { agent: step.agent, status: step.status, output: String(step.output || ""), details: step.details || null, model: step.contribution?.model || step.model || null, finishedAt: new Date().toISOString() };
}

function createMissionEngine({ store, runStage, now = () => Date.now() }) {
  const input = mission => ({ missionId: mission.id, workspaceId: mission.workspace_id, userId: mission.user_id, company: mission.company, objective: mission.objective });

  async function advance(id) {
    const mission = await store.claim(id, LEASE_MS);
    if (!mission) return { advanced: false };
    let steps = Array.isArray(mission.steps) ? mission.steps : [];
    const save = values => store.update(id, { ...values, updated_at: new Date(now()).toISOString() });
    try {
      if (mission.status === "running") {
        for (const [stage, agent] of PRE_APPROVAL) {
          if (steps.some(step => step.agent === agent)) continue;
          steps = [...steps, cleanStep(await runStage(stage, input(mission), steps))];
          await save({ steps });
        }
        await save({ status: "awaiting_approval", steps, error: null, attempts: 0, locked_until: null });
        return { advanced: true, status: "awaiting_approval" };
      }
      if (mission.status === "executing") {
        if (!steps.some(step => step.agent === "Operations")) {
          const comment = mission.decision?.comment ? `: ${mission.decision.comment}` : "";
          steps = [...steps, cleanStep({ agent: "Operations", status: "prepared", output: `Founder approved execution${comment}. Connected-tool execution is prepared but not performed: nothing was published, sent, or charged.` })];
          await save({ steps });
        }
        if (!steps.some(step => step.agent === "Reviewer")) {
          steps = [...steps, cleanStep(await runStage("review", input(mission), steps))];
          await save({ steps });
        }
        await save({ status: "completed", steps, error: null, attempts: 0, locked_until: null });
        return { advanced: true, status: "completed" };
      }
      await save({ locked_until: null });
      return { advanced: false, status: mission.status };
    } catch (error) {
      const attempts = Number(mission.attempts || 0) + 1;
      await save({ steps, attempts, error: String(error?.message || error).slice(0, 300), status: attempts >= MAX_ATTEMPTS ? "failed" : mission.status, resume_status: mission.status, locked_until: null });
      return { advanced: false, status: attempts >= MAX_ATTEMPTS ? "failed" : mission.status, error: error.message };
    }
  }

  // Missions mid-stage with no live lease and no recent progress have lost
  // their worker; they are picked up again on the next list or cron run.
  function needsResume(mission) {
    if (!["running", "executing"].includes(mission.status)) return false;
    const lockFree = !mission.locked_until || Date.parse(mission.locked_until) < now();
    return lockFree && now() - Date.parse(mission.updated_at || mission.created_at) > STALE_MS;
  }

  return {
    advance,
    needsResume,

    async start({ workspaceId, userId, company, objective }) {
      const timestamp = new Date(now()).toISOString();
      return store.insert({ workspace_id: workspaceId, user_id: userId || null, company: String(company || "Company").slice(0, 100), objective, status: "running", steps: [], attempts: 0, created_at: timestamp, updated_at: timestamp });
    },

    async decide({ mission, approved, comment }) {
      if (mission.status !== "awaiting_approval") throw Object.assign(new Error("This mission is not waiting for a decision"), { status: 409 });
      const decision = { approved: approved === true, comment: String(comment || "").slice(0, 500), decidedAt: new Date(now()).toISOString() };
      await store.update(mission.id, { status: decision.approved ? "executing" : "rejected", decision, updated_at: decision.decidedAt });
      return { ...mission, status: decision.approved ? "executing" : "rejected", decision };
    },

    async retry(mission) {
      if (mission.status !== "failed") throw Object.assign(new Error("Only failed missions can be retried"), { status: 409 });
      const status = mission.resume_status === "executing" ? "executing" : "running";
      await store.update(mission.id, { status, attempts: 0, error: null, locked_until: null, updated_at: new Date(now()).toISOString() });
      return { ...mission, status };
    }
  };
}

// The shape the Autopilot screen expects.
function publicMission(mission) {
  return {
    id: mission.id, runId: mission.id, objective: mission.objective,
    status: mission.status === "awaiting_approval" || mission.status === "executing" ? "running" : mission.status,
    stage: mission.status === "awaiting_approval" ? "awaiting_approval" : mission.status === "executing" ? "executing" : null,
    steps: mission.steps || [], decision: mission.decision || null, error: mission.error || null, attempts: Number(mission.attempts || 0),
    createdAt: mission.created_at, updatedAt: mission.updated_at
  };
}

module.exports = { createMissionEngine, publicMission, MAX_ATTEMPTS };
