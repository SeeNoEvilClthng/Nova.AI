// Consent-based follow-up email to people who signed up on a company's
// published launch page. Nothing is sent without the founder approving the
// exact subject and body for that batch. Every message names why the person
// is receiving it, carries a working one-click unsubscribe link, and replies
// go to the founder. Sending uses the platform's Resend account
// (RESEND_API_KEY, NOVA_EMAIL_FROM); without it, drafts can still be copied.
const crypto = require("node:crypto");

const MAX_PER_BATCH = 50;
const MAX_PER_DAY = 100;

function emailConfig() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim(), from = String(process.env.NOVA_EMAIL_FROM || "").trim();
  return apiKey && from ? { apiKey, from } : null;
}

function signingSecret() {
  const secret = process.env.EXECUTION_RECEIPT_SECRET || process.env.SUPABASE_SECRET_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") throw Object.assign(new Error("EXECUTION_RECEIPT_SECRET is required to sign unsubscribe links"), { status: 503 });
  return "nova-local-development-unsubscribe-key";
}

// Unsubscribe tokens are HMAC-signed lead IDs, so links can't be forged to
// unsubscribe someone else.
function unsubscribeToken(leadId) {
  const payload = Buffer.from(String(leadId)).toString("base64url");
  return `${payload}.${crypto.createHmac("sha256", signingSecret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 32)}`;
}

function verifyUnsubscribeToken(token) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", signingSecret()).update(`unsubscribe:${payload}`).digest("base64url").slice(0, 32);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return Buffer.from(payload, "base64url").toString("utf8");
}

function cleanDraft({ subject, body }) {
  const cleanSubject = String(subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 150);
  const cleanBody = String(body || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (cleanSubject.length < 3 || cleanBody.length < 20) throw Object.assign(new Error("Write a subject and a message of at least 20 characters"), { status: 400 });
  return { subject: cleanSubject, body: cleanBody };
}

function messageFor({ lead, draft, company, pageUrl, appUrl }) {
  const unsubscribeUrl = `${appUrl}/u/${unsubscribeToken(lead.id)}`;
  const footer = `\n\n—\nYou're receiving this because you signed up for updates from ${company}${pageUrl ? ` at ${pageUrl}` : ""}. Reply to this email to reach us directly.\nUnsubscribe: ${unsubscribeUrl}`;
  return { to: lead.email, subject: draft.subject, text: `${draft.body}${footer}`, unsubscribeUrl };
}

async function sendViaResend({ config, message, replyTo, idempotencyKey, fetchImpl = fetch }) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ from: config.from, to: [message.to], subject: message.subject, text: message.text, ...(replyTo ? { reply_to: replyTo } : {}), headers: { "List-Unsubscribe": `<${message.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
    signal: AbortSignal.timeout(15_000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.message || `Email provider rejected the message (${response.status})`);
  return String(result.id || "");
}

// Sends one approved batch. Leads are pre-filtered to "new" and not
// unsubscribed; caps protect sender reputation and recipients.
async function sendBatch({ leads, draft, company, pageUrl, appUrl, replyTo, sentToday, batchId, send }) {
  const remainingToday = Math.max(0, MAX_PER_DAY - sentToday);
  const recipients = leads.slice(0, Math.min(MAX_PER_BATCH, remainingToday));
  const results = [];
  for (const lead of recipients) {
    const message = messageFor({ lead, draft, company, pageUrl, appUrl });
    try { results.push({ lead, status: "sent", providerId: await send(message, replyTo, `nova-${batchId}-${lead.id}`) }); }
    catch (error) { results.push({ lead, status: "failed", error: String(error.message).slice(0, 200) }); }
  }
  return { results, skippedForLimits: leads.length - recipients.length };
}

function templateFollowUp({ company, offer, pageUrl }) {
  return {
    subject: `Thanks for your interest in ${company}`,
    body: `Hi,\n\nThanks for signing up for ${company}. I'm reaching out personally to learn what made you sign up and what you're hoping it will help with.\n\n${offer ? `If you're ready to try it, our ${offer.name} is available here: ${offer.url}\n\n` : ""}Would you be open to a quick reply telling me about your situation? Every answer shapes what we build.\n\nThanks,\nThe ${company} team`
  };
}

module.exports = { emailConfig, unsubscribeToken, verifyUnsubscribeToken, cleanDraft, messageFor, sendViaResend, sendBatch, templateFollowUp, MAX_PER_BATCH, MAX_PER_DAY };
