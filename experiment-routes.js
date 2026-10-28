// Launch-page A/B test routes. One running test per published page; version A
// is the current headline and subheading, version B is written by the founder
// or drafted by the Growth agent. Applying a winner changes the public page,
// so it only happens on the founder's click or an approved Action Center item.
const supabase = require("./supabase");
const router = require("./router");
const { experimentResults, cleanVariantCopy } = require("./experiments");
const { assertCanGenerate, usageLedger } = require("./ai-access");

const variantSchema = { type: "object", additionalProperties: false, required: ["headline", "subhead", "hypothesis"], properties: { headline: { type: "string", maxLength: 130 }, subhead: { type: "string", maxLength: 240 }, hypothesis: { type: "string", maxLength: 300 } } };

async function resultsFor(experiment) {
  const [events, orders] = await Promise.all([supabase.adminExperimentEvents(experiment.page_id, experiment.id), supabase.adminOrdersForAttribution(experiment.workspace_id).catch(() => [])]);
  return experimentResults({ events, orders });
}

function publicExperiment(experiment, results) {
  return { id: experiment.id, status: experiment.status, variants: experiment.variants, winner: experiment.winner || null, appliedVariant: experiment.applied_variant || null, createdAt: experiment.created_at, endedAt: experiment.ended_at, results: results || null };
}

// Shared by the founder's "Apply" button and the approved Action Center item.
async function applyWinner({ experimentId, variant }) {
  if (!["a", "b"].includes(variant)) throw Object.assign(new Error("Choose version A or B"), { status: 400 });
  const experiment = await supabase.adminGetExperiment(experimentId);
  if (!experiment || experiment.status !== "running") throw Object.assign(new Error("This test has already ended"), { status: 409 });
  const results = await resultsFor(experiment);
  if (variant === "b") {
    const page = await supabase.adminGetPageById(experiment.page_id), copy = experiment.variants.b;
    if (!page) throw Object.assign(new Error("Launch page not found"), { status: 404 });
    await supabase.adminUpdatePageSnapshot(page.id, { ...(page.snapshot || {}), headline: copy.headline, subhead: copy.subhead });
    const workspace = await supabase.adminGetWorkspace(experiment.workspace_id, "id,state");
    if (workspace?.state?.site) await supabase.adminSaveWorkspace(workspace.id, { ...workspace.state, site: { ...workspace.state.site, headline: copy.headline, subhead: copy.subhead } });
  }
  const ended = await supabase.endExperiment(experiment.id, { status: "completed", winner: results.winner, applied_variant: variant });
  if (!ended) throw Object.assign(new Error("This test has already ended"), { status: 409 });
  return { experiment: ended, results };
}

// Used by the operator: a running test with a statistically significant
// winner becomes an Action Center proposal.
async function runningExperimentResults(workspaceId) {
  const page = await supabase.adminGetOwnerPage(workspaceId);
  if (!page) return null;
  const experiment = await supabase.adminRunningExperiment(page.id);
  return experiment ? { experiment, results: await resultsFor(experiment) } : null;
}

async function handleExperiments({ req, res, pathname, requestUrl, sendJson, readBody }) {
  if (!pathname.startsWith("/api/experiments")) return false;
  try {
    if (!supabase.configured()) return sendJson(res, 503, { error: "A/B tests require Supabase" }), true;
    const user = await supabase.verifyUser(req);
    const input = req.method === "GET" ? {} : await readBody(req);
    const workspaceId = String(req.method === "GET" ? requestUrl.searchParams.get("workspace") || "" : input.workspaceId || "");
    const workspace = workspaceId ? await supabase.getWorkspace(req, workspaceId) : null;
    if (!workspace) return sendJson(res, 404, { error: "Workspace not found" }), true;
    const page = await supabase.getOwnerPage(req, workspace.id);

    if (pathname === "/api/experiments" && req.method === "GET") {
      const experiments = await supabase.listExperiments(req, workspace.id);
      const withResults = await Promise.all(experiments.map(async (experiment, index) => publicExperiment(experiment, experiment.status === "running" || index === 0 ? await resultsFor(experiment).catch(() => null) : null)));
      return sendJson(res, 200, { published: Boolean(page?.published), current: { headline: page?.snapshot?.headline || "", subhead: page?.snapshot?.subhead || "" }, experiments: withResults }), true;
    }

    if (pathname === "/api/experiments/draft" && req.method === "POST") {
      if (!page) return sendJson(res, 409, { error: "Publish a launch page first" }), true;
      await assertCanGenerate(req, user, workspace.id);
      const current = { headline: page.snapshot?.headline || "", subhead: page.snapshot?.subhead || "" };
      const { result, contribution } = await router.generateAgentTask({ plan: workspace.state?.plan || null, current, founderNotes: String(input.notes || "").slice(0, 400) }, () => ({ headline: `${current.headline}`.slice(0, 120), subhead: current.subhead, hypothesis: "Template: no AI model is configured. Write version B yourself." }), variantSchema, {
        role: "Growth Agent", schemaName: "headline_variant", tier: "fast",
        instructions: "You are Nova.Ai's Growth Agent. Write ONE alternative launch-page headline and subheading to A/B test against the current one. Test a genuinely different angle (for example the outcome, the pain, or the specific customer) rather than rewording. Stay truthful: no invented numbers, results, testimonials, scarcity or guarantees. Explain the hypothesis in one sentence. Return JSON with headline, subhead and hypothesis."
      });
      await usageLedger.record(contribution, { workspaceId: workspace.id, userId: user.id, operation: "headline-variant" });
      return sendJson(res, 200, { variant: { headline: String(result.headline || "").slice(0, 130), subhead: String(result.subhead || "").slice(0, 240), hypothesis: String(result.hypothesis || "").slice(0, 300) }, templated: contribution.model === "Demo engine" }), true;
    }

    if (pathname === "/api/experiments" && req.method === "POST") {
      if (!page?.published) return sendJson(res, 409, { error: "Publish your launch page before starting a test" }), true;
      if (await supabase.adminRunningExperiment(page.id)) return sendJson(res, 409, { error: "A test is already running on this page. End it first." }), true;
      const b = cleanVariantCopy(input), a = { headline: String(page.snapshot?.headline || ""), subhead: String(page.snapshot?.subhead || "") };
      if (b.headline === a.headline && b.subhead === a.subhead) return sendJson(res, 400, { error: "Version B must differ from the current page" }), true;
      const experiment = await supabase.insertExperiment({ workspace_id: workspace.id, page_id: page.id, status: "running", variants: { a, b: { ...b, hypothesis: String(input.hypothesis || "").slice(0, 300) } } });
      return sendJson(res, 201, { experiment: publicExperiment(experiment, null) }), true;
    }

    const end = pathname.match(/^\/api\/experiments\/([0-9a-f-]{36})\/end$/i);
    if (end && req.method === "POST") {
      const owned = (await supabase.listExperiments(req, workspace.id)).find(item => item.id === end[1]);
      if (!owned) return sendJson(res, 404, { error: "Test not found" }), true;
      if (input.confirm !== true) return sendJson(res, 400, { error: "Confirm which version should stay on the live page" }), true;
      const { experiment, results } = await applyWinner({ experimentId: owned.id, variant: input.keep === "b" ? "b" : "a" });
      return sendJson(res, 200, { experiment: publicExperiment(experiment, results) }), true;
    }
    return sendJson(res, 404, { error: "Not found" }), true;
  } catch (error) {
    return sendJson(res, error.status || 500, { error: error.message || "A/B test request failed" }), true;
  }
}

module.exports = { handleExperiments, applyWinner, runningExperimentResults };
