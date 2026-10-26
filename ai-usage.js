// Server-authoritative AI metering. Token usage used to live only in the
// browser-saved workspace state, so a client could lower it and bypass the AI
// budget. Every generation is now written to a ledger that signed-in users can
// read but never write.
const { randomUUID } = require("node:crypto");

const DEMO_MODEL = "Demo engine";
let warnedUnavailable = false;

function usageRows(contributions, { workspaceId, userId, operation }) {
  return (Array.isArray(contributions) ? contributions : [contributions]).filter(Boolean).map(contribution => {
    const usage = contribution.usage || {}, count = value => Math.max(0, Math.floor(Number(value) || 0));
    const inputTokens = count(usage.inputTokens), outputTokens = count(usage.outputTokens);
    const latency = Number(contribution.latencyMs);
    return {
      generation_id: String(contribution.id || randomUUID()).slice(0, 120),
      user_id: userId || null,
      workspace_id: workspaceId,
      operation: String(operation || "generation").slice(0, 60),
      provider: String(contribution.provider || "unknown").slice(0, 60),
      model: String(contribution.model || "unknown").slice(0, 120),
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: count(usage.totalTokens) || inputTokens + outputTokens,
      latency_ms: Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : null,
      fallback: contribution.model === DEMO_MODEL
    };
  });
}

function unavailable(error) {
  if (!warnedUnavailable) console.warn("AI usage ledger unavailable; falling back to workspace state:", error.message);
  warnedUnavailable = true;
  return null;
}

function createUsageLedger({ supabase, database }) {
  const remote = () => supabase.configured();
  return {
    // Never throws: metering problems must not discard a generation the
    // founder already waited for. The state-based budget still applies.
    async record(contributions, context) {
      const workspaceId = String(context?.workspaceId || "").trim();
      if (!workspaceId) return 0;
      const rows = usageRows(contributions, { ...context, workspaceId });
      if (!rows.length) return 0;
      try {
        if (remote()) await supabase.insertAiUsage(rows);
        else database.insertAiUsage(rows);
        return rows.length;
      } catch (error) { unavailable(error); return 0; }
    },
    // Returns null when the ledger cannot be read so callers fall back to state.
    async workspaceTokens(req, workspaceId) {
      try { return remote() ? await supabase.workspaceAiTokens(req, workspaceId) : database.workspaceAiTokens(workspaceId); }
      catch (error) { return unavailable(error); }
    }
  };
}

module.exports = { usageRows, createUsageLedger };
