// Action Center: concrete, executable actions proposed by agents.
//
//   proposed ──founder approves──▶ approved ──▶ executing ──▶ succeeded | failed
//   proposed ──founder rejects───▶ rejected
//   failed ──founder retries─────▶ approved
//
// Every action reaches the outside world (email, Stripe), so nothing runs
// without the founder approving that specific action. Execution is claimed
// with a conditional state change, so an action can never run twice at once.
// Results carry the provider's own IDs as evidence and an HMAC receipt that
// covers the evidence, so a stored proof can't be edited after the fact.
const crypto = require("node:crypto");

const KINDS = {
  lead_followup: {
    label: "Email new leads",
    clean: payload => {
      const subject = String(payload.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 150), body = String(payload.body || "").trim().slice(0, 5000);
      if (subject.length < 3 || body.length < 20) throw Object.assign(new Error("The email needs a subject and a message"), { status: 400 });
      return { subject, body, leadCount: Math.max(0, Math.floor(Number(payload.leadCount) || 0)) };
    }
  },
  offer_go_live: {
    label: "Take an offer live",
    clean: payload => {
      const offerId = String(payload.offerId || "").slice(0, 100);
      if (!offerId) throw Object.assign(new Error("The action needs an offer"), { status: 400 });
      return { offerId, name: String(payload.name || "").slice(0, 100), price: Number(payload.price) || 0, currency: String(payload.currency || "USD").slice(0, 3), billing: String(payload.billing || "one_time").slice(0, 20) };
    }
  }
};

function receiptSecret() {
  const secret = process.env.EXECUTION_RECEIPT_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw Object.assign(new Error("EXECUTION_RECEIPT_SECRET is required in production"), { status: 503 });
  return "nova-local-development-receipt-key";
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

function signActionReceipt(action, secret = receiptSecret()) {
  const evidenceHash = crypto.createHash("sha256").update(canonical(action.evidence)).digest("hex");
  return crypto.createHmac("sha256", secret).update([action.workspace_id, action.id, action.kind, action.status, action.executed_at, evidenceHash].join("|")).digest("hex");
}

function validActionReceipt(action, secret = receiptSecret()) {
  if (!action?.receipt) return false;
  const expected = Buffer.from(signActionReceipt(action, secret)), actual = Buffer.from(String(action.receipt));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function createActionEngine({ store, executors, now = () => new Date().toISOString() }) {
  return {
    // Proposals are deduplicated: only one open action per dedupe key.
    async propose({ workspaceId, kind, title, summary, payload, dedupeKey, source = "operator" }) {
      const definition = KINDS[kind];
      if (!definition) throw new Error(`Unknown action kind: ${kind}`);
      const cleanPayload = definition.clean(payload || {});
      const key = String(dedupeKey || kind).slice(0, 160), existing = await store.findOpen(workspaceId, key);
      if (existing) return { action: existing, created: false };
      const action = await store.insert({ workspace_id: workspaceId, kind, title: String(title || definition.label).slice(0, 160), summary: String(summary || "").slice(0, 600), payload: cleanPayload, status: "proposed", source, dedupe_key: key });
      return { action, created: true };
    },

    async decide({ action, approved, approverEmail }) {
      if (action.status !== "proposed") throw Object.assign(new Error("This action is no longer waiting for a decision"), { status: 409 });
      const updated = await store.transition(action.id, "proposed", { status: approved ? "approved" : "rejected", approver_email: approved ? String(approverEmail || "").slice(0, 254) || null : null, decided_at: now() });
      if (!updated) throw Object.assign(new Error("This action was already decided"), { status: 409 });
      return updated;
    },

    async retry(action) {
      const updated = action.status === "failed" ? await store.transition(action.id, "failed", { status: "approved", error: null }) : null;
      if (!updated) throw Object.assign(new Error("Only failed actions can be retried"), { status: 409 });
      return updated;
    },

    async execute(id) {
      const action = await store.transition(id, "approved", { status: "executing" });
      if (!action) return { executed: false };
      try {
        const evidence = await executors[action.kind](action);
        const executedAt = now(), finished = { ...action, status: "succeeded", evidence, executed_at: executedAt };
        await store.transition(id, "executing", { status: "succeeded", evidence, executed_at: executedAt, error: null, receipt: signActionReceipt(finished) });
        return { executed: true, status: "succeeded", evidence };
      } catch (error) {
        await store.transition(id, "executing", { status: "failed", error: String(error?.message || error).slice(0, 300) });
        return { executed: false, status: "failed", error: error.message };
      }
    }
  };
}

function publicAction(action, secret) {
  let verified = false;
  try { verified = action.status === "succeeded" && validActionReceipt(action, secret); } catch { verified = false; }
  return {
    id: action.id, kind: action.kind, kindLabel: KINDS[action.kind]?.label || action.kind, title: action.title, summary: action.summary, payload: action.payload,
    status: action.status, source: action.source, decidedAt: action.decided_at, executedAt: action.executed_at, evidence: action.evidence || null,
    receipt: action.receipt ? String(action.receipt).slice(0, 12) : null, receiptVerified: verified, error: action.error || null, createdAt: action.created_at
  };
}

module.exports = { createActionEngine, publicAction, signActionReceipt, validActionReceipt, KINDS };
