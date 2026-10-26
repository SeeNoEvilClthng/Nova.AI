const baseUrl = () => String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
const publishableKey = () => process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const configured = () => Boolean(baseUrl() && publishableKey());
const secretKey = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function publicConfig() {
  return { enabled: configured(), url: configured() ? baseUrl() : "", publishableKey: configured() ? publishableKey() : "" };
}

function tokenFromRequest(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

async function request(path, req, options = {}) {
  const token = tokenFromRequest(req);
  if (!token) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: {
      apikey: publishableKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = await response.text();
    throw Object.assign(new Error(detail || `Supabase request failed (${response.status})`), { status: response.status });
  }
  if (response.status === 204) return null;
  return response.json();
}

async function verifyUser(req) {
  return request("/auth/v1/user", req);
}

async function listWorkspaces(req) {
  return request("/rest/v1/nova_workspaces?select=id,name,created_at,updated_at&order=updated_at.desc", req);
}

async function createWorkspace(req, name) {
  const rows = await request("/rest/v1/nova_workspaces", req, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: String(name || "New venture").trim().slice(0, 80) || "New venture" })
  });
  return rows[0];
}

async function getWorkspace(req, id) {
  const suffix = id ? `&id=eq.${encodeURIComponent(id)}` : "&order=updated_at.desc&limit=1";
  const rows = await request(`/rest/v1/nova_workspaces?select=id,name,state,created_at,updated_at${suffix}`, req);
  return rows[0] || null;
}

async function saveWorkspace(req, id, state) {
  const rows = await request(`/rest/v1/nova_workspaces?id=eq.${encodeURIComponent(id)}&select=id,name,state,created_at,updated_at`, req, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ state, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

async function renameWorkspace(req, id, name) {
  const cleanName = String(name || "").trim().slice(0, 80);
  if (!cleanName) throw Object.assign(new Error("Company name is required"), { status: 400 });
  const rows = await request(`/rest/v1/nova_workspaces?id=eq.${encodeURIComponent(id)}&select=id,name,state,created_at,updated_at`, req, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ name: cleanName, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

async function deleteWorkspace(req, id) {
  const workspaces = await listWorkspaces(req);
  if (workspaces.length <= 1) throw Object.assign(new Error("Keep at least one company workspace"), { status: 400 });
  const rows = await request(`/rest/v1/nova_workspaces?id=eq.${encodeURIComponent(id)}&select=id`, req, {
    method: "DELETE",
    headers: { Prefer: "return=representation" }
  });
  return Boolean(rows[0]);
}

async function getSubscription(req) {
  const rows = await request("/rest/v1/nova_subscriptions?select=user_id,stripe_customer_id,stripe_price_id,tier,status,current_period_end,cancel_at_period_end,updated_at&limit=1", req);
  return rows[0] || null;
}

async function adminRequest(path, options = {}) {
  if (!secretKey()) throw Object.assign(new Error("Supabase server secret is not configured"), { status: 503 });
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { apikey: secretKey(), Authorization: `Bearer ${secretKey()}`, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) throw Object.assign(new Error(await response.text() || "Supabase admin request failed"), { status: response.status });
  return response.status === 204 ? null : response.json();
}

async function upsertSubscription(value) {
  return adminRequest("/rest/v1/nova_subscriptions?on_conflict=user_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(value)
  });
}

async function findSubscriptionByStripeId(subscriptionId) {
  const rows = await adminRequest(`/rest/v1/nova_subscriptions?stripe_subscription_id=eq.${encodeURIComponent(subscriptionId)}&select=*`);
  return rows[0] || null;
}

async function adminListWorkspaces() {
  return adminRequest("/rest/v1/nova_workspaces?select=id,name,state,updated_at&order=updated_at.asc");
}

async function adminSaveWorkspace(id, state) {
  const rows = await adminRequest(`/rest/v1/nova_workspaces?id=eq.${encodeURIComponent(id)}&select=id,name,state,updated_at`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ state, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

async function getSocialConnection(userId, workspaceId, provider) {
  const rows=await adminRequest(`/rest/v1/nova_social_connections?user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}&select=*&limit=1`);
  return rows[0]||null;
}

async function upsertSocialConnection(value) {
  const rows=await adminRequest("/rest/v1/nova_social_connections?on_conflict=user_id,workspace_id,provider",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=representation"},body:JSON.stringify({...value,updated_at:new Date().toISOString()})});
  return rows[0]||null;
}

async function deleteSocialConnection(userId, workspaceId, provider) {
  const rows=await adminRequest(`/rest/v1/nova_social_connections?user_id=eq.${encodeURIComponent(userId)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&provider=eq.${encodeURIComponent(provider)}&select=id`,{method:"DELETE",headers:{Prefer:"return=representation"}});
  return Boolean(rows[0]);
}

async function listValidation(req, workspaceId) {
  return request(`/rest/v1/nova_validation_entries?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,respondent_name,respondent_email,notes,demand_score,urgency_score,willingness_score,created_at&order=created_at.desc`, req);
}

async function createValidation(req, input) {
  const rows = await request("/rest/v1/nova_validation_entries", req, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(input)
  });
  return rows[0];
}

async function deleteValidation(req, id) {
  return request(`/rest/v1/nova_validation_entries?id=eq.${encodeURIComponent(id)}`, req, { method: "DELETE" });
}

async function publicRequest(path, options = {}) {
  const response = await fetch(`${baseUrl()}${path}`, { ...options, headers: { apikey: publishableKey(), Authorization: `Bearer ${publishableKey()}`, "Content-Type": "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw Object.assign(new Error(await response.text() || "Public data request failed"), { status: response.status });
  return response.status === 204 ? null : response.json();
}

async function getPublishedPage(slug) {
  const rows = await publicRequest(`/rest/v1/nova_published_pages?slug=eq.${encodeURIComponent(slug)}&published=eq.true&select=id,workspace_id,slug,title,snapshot,published_at&limit=1`);
  return rows[0] || null;
}

async function getOwnerPage(req, workspaceId) {
  const rows = await request(`/rest/v1/nova_published_pages?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,slug,title,snapshot,published,published_at,updated_at&limit=1`, req);
  return rows[0] || null;
}

async function publishPage(req, value) {
  const rows = await request("/rest/v1/nova_published_pages?on_conflict=workspace_id", req, { method:"POST", headers:{ Prefer:"resolution=merge-duplicates,return=representation" }, body:JSON.stringify(value) });
  return rows[0];
}

async function unpublishPage(req, workspaceId) {
  const rows = await request(`/rest/v1/nova_published_pages?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`, req, { method:"PATCH", headers:{ Prefer:"return=representation" }, body:JSON.stringify({ published:false, updated_at:new Date().toISOString() }) });
  return rows[0] || null;
}

// Visitor writes go through the server (rate limited, optionally CAPTCHA
// checked) with the service role; anonymous Data API inserts are revoked so
// they cannot bypass those checks.
async function captureLead(pageId, email) {
  return adminRequest("/rest/v1/nova_page_leads", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ page_id:pageId, email }) });
}

async function recordPageEvent(pageId, eventType) {
  return adminRequest("/rest/v1/nova_page_events", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ page_id:pageId, event_type:eventType }) });
}

// Returns true when the caller is over the limit.
async function rateLimitHit(bucket, maxHits, windowSeconds) {
  return Boolean(await adminRequest("/rest/v1/rpc/nova_rate_limit_hit", { method:"POST", body:JSON.stringify({ bucket_key:bucket, max_hits:maxHits, window_seconds:windowSeconds }) }));
}

// Counts rows in the database instead of downloading them. The previous
// approach fetched every event row, which got slower with traffic and was
// silently capped at the Data API's 1,000-row response limit.
async function countRows(path, req) {
  const token = tokenFromRequest(req);
  if (!token) throw Object.assign(new Error("Authentication required"), { status: 401 });
  const response = await fetch(`${baseUrl()}${path}`, { method: "HEAD", headers: { apikey: publishableKey(), Authorization: `Bearer ${token}`, Prefer: "count=exact" } });
  if (!response.ok) throw Object.assign(new Error(`Supabase count failed (${response.status})`), { status: response.status });
  const total = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function getPageStats(req, pageId) {
  const page = encodeURIComponent(pageId);
  const [views, signups, leads] = await Promise.all([
    countRows(`/rest/v1/nova_page_events?page_id=eq.${page}&event_type=eq.view&select=id`, req),
    countRows(`/rest/v1/nova_page_leads?page_id=eq.${page}&select=id`, req),
    request(`/rest/v1/nova_page_leads?page_id=eq.${page}&select=id,email,status,created_at,updated_at&order=created_at.desc&limit=200`, req)
  ]);
  return { views, signups, leads };
}

async function insertAiUsage(rows) {
  return adminRequest("/rest/v1/nova_ai_usage_events?on_conflict=workspace_id,generation_id", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
}

async function workspaceAiTokens(req, workspaceId) {
  const total = await request("/rest/v1/rpc/nova_workspace_ai_tokens", req, { method: "POST", body: JSON.stringify({ target: workspaceId }) });
  return Number(total) || 0;
}

async function adminGetWorkspace(id, fields = "id,user_id,name") {
  const rows = await adminRequest(`/rest/v1/nova_workspaces?id=eq.${encodeURIComponent(id)}&select=${fields}&limit=1`);
  return rows[0] || null;
}

// Filters in the database so the daily cron no longer downloads every
// workspace's full state to find the few with automation enabled.
async function adminListAutomatedWorkspaces() {
  return adminRequest("/rest/v1/nova_workspaces?select=id,name,state,updated_at&state->resellerStudio->campaignAutomation->>enabled=eq.true&order=updated_at.asc");
}

async function updateLead(req, id, status) {
  const rows = await request(`/rest/v1/nova_page_leads?id=eq.${encodeURIComponent(id)}&select=id,email,status,created_at,updated_at`, req, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

const hasSecret = () => Boolean(secretKey());

// Durable missions. Founders read their own through RLS; the server writes.
const MISSION_FIELDS = "id,workspace_id,user_id,company,objective,status,resume_status,steps,decision,error,attempts,locked_until,created_at,updated_at";
async function insertMission(row) {
  const rows = await adminRequest("/rest/v1/nova_missions", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  return rows[0];
}
async function listMissions(req, workspaceId) {
  return request(`/rest/v1/nova_missions?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${MISSION_FIELDS}&order=created_at.desc&limit=30`, req);
}
async function getMission(req, workspaceId, id) {
  const rows = await request(`/rest/v1/nova_missions?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=${MISSION_FIELDS}&limit=1`, req);
  return rows[0] || null;
}
// Takes the lease only if nobody holds a live one; returns null otherwise.
async function claimMission(id, leaseMs) {
  const now = new Date().toISOString(), until = new Date(Date.now() + leaseMs).toISOString();
  const rows = await adminRequest(`/rest/v1/nova_missions?id=eq.${encodeURIComponent(id)}&or=(locked_until.is.null,locked_until.lt.${encodeURIComponent(now)})&select=${MISSION_FIELDS}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ locked_until: until }) });
  return rows[0] || null;
}
async function updateMission(id, values) {
  return adminRequest(`/rest/v1/nova_missions?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) });
}
async function adminListActiveMissions() {
  return adminRequest(`/rest/v1/nova_missions?status=in.(running,executing)&select=${MISSION_FIELDS}&order=updated_at.asc&limit=50`);
}

// Autonomous operator storage and server-side reads used by scheduled cycles,
// which run without a signed-in user.
async function adminCount(path) {
  if (!secretKey()) throw Object.assign(new Error("Supabase server secret is not configured"), { status: 503 });
  const response = await fetch(`${baseUrl()}${path}`, { method: "HEAD", headers: { apikey: secretKey(), Authorization: `Bearer ${secretKey()}`, Prefer: "count=exact" } });
  if (!response.ok) throw Object.assign(new Error(`Supabase count failed (${response.status})`), { status: response.status });
  const total = Number(String(response.headers.get("content-range") || "").split("/")[1]);
  return Number.isFinite(total) ? total : 0;
}

async function adminPageMetrics(workspaceId) {
  const pages = await adminRequest(`/rest/v1/nova_published_pages?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,published&limit=1`), page = pages[0];
  if (!page) return { published: false, views: 0, signups: 0, newLeads: 0 };
  const id = encodeURIComponent(page.id);
  const [views, signups, newLeads] = await Promise.all([
    adminCount(`/rest/v1/nova_page_events?page_id=eq.${id}&event_type=eq.view&select=id`),
    adminCount(`/rest/v1/nova_page_leads?page_id=eq.${id}&select=id`),
    adminCount(`/rest/v1/nova_page_leads?page_id=eq.${id}&status=eq.new&select=id`)
  ]);
  return { published: Boolean(page.published), views, signups, newLeads };
}

async function adminValidationCount(workspaceId) {
  return adminCount(`/rest/v1/nova_validation_entries?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id`);
}

async function adminListOrders(workspaceId) {
  return adminRequest(`/rest/v1/nova_orders?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=amount_minor,refunded_minor,currency,mode,paid_at&order=paid_at.desc&limit=500`);
}

async function adminWorkspaceTokens(workspaceId) {
  return Number(await adminRequest("/rest/v1/rpc/nova_workspace_ai_tokens", { method: "POST", body: JSON.stringify({ target: workspaceId }) })) || 0;
}

async function adminTokensSince(workspaceId, since, operationPrefix) {
  const rows = await adminRequest(`/rest/v1/nova_ai_usage_events?workspace_id=eq.${encodeURIComponent(workspaceId)}&created_at=gte.${encodeURIComponent(since)}&operation=like.${encodeURIComponent(operationPrefix)}*&select=total_tokens&limit=1000`);
  return rows.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0);
}

async function adminGetSubscription(userId) {
  const rows = await adminRequest(`/rest/v1/nova_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=tier,status&limit=1`);
  return rows[0] || null;
}

async function adminListOperatorWorkspaces() {
  return adminRequest("/rest/v1/nova_workspaces?select=id,user_id,name,state&state->operatingMode->>mode=in.(supervised,autopilot)&state->operatingMode->>paused=eq.false&limit=200");
}

async function insertOperatorRun(row) {
  const rows = await adminRequest("/rest/v1/nova_operator_runs", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  return rows[0];
}

async function updateOperatorRun(id, values) {
  return adminRequest(`/rest/v1/nova_operator_runs?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(values) });
}

async function adminLatestOperatorRun(workspaceId) {
  const rows = await adminRequest(`/rest/v1/nova_operator_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,status,started_at&order=started_at.desc&limit=1`);
  return rows[0] || null;
}

async function listOperatorRuns(req, workspaceId) {
  return request(`/rest/v1/nova_operator_runs?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,trigger,mode,status,metrics,brief,drafts,model,tokens,error,started_at,finished_at&order=started_at.desc&limit=10`, req);
}

// Revenue Engine storage. Payment credentials and orders are written only with
// the server secret; owners can read their own orders through RLS.
async function getPaymentConnection(workspaceId) {
  const rows = await adminRequest(`/rest/v1/nova_payment_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*&limit=1`);
  return rows[0] || null;
}

async function savePaymentConnection(row) {
  return adminRequest("/rest/v1/nova_payment_connections?on_conflict=workspace_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ ...row, last_synced_at: null, updated_at: new Date().toISOString() }) });
}

async function deletePaymentConnection(workspaceId) {
  return adminRequest(`/rest/v1/nova_payment_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
}

async function markPaymentSynced(workspaceId, at) {
  return adminRequest(`/rest/v1/nova_payment_connections?workspace_id=eq.${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify({ last_synced_at: at, updated_at: at }) });
}

async function listPaymentConnections() {
  return adminRequest("/rest/v1/nova_payment_connections?select=workspace_id&order=last_synced_at.asc.nullsfirst&limit=200");
}

async function upsertOrders(rows) {
  return adminRequest("/rest/v1/nova_orders?on_conflict=provider,external_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.map(row => ({ ...row, synced_at: new Date().toISOString() }))) });
}

async function listOrders(req, workspaceId) {
  return request(`/rest/v1/nova_orders?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,external_id,offer_id,mode,status,amount_minor,refunded_minor,currency,customer_email,paid_at&order=paid_at.desc&limit=500`, req);
}

async function countPageViews(req, workspaceId) {
  const page = await getOwnerPage(req, workspaceId);
  return page ? countRows(`/rest/v1/nova_page_events?page_id=eq.${encodeURIComponent(page.id)}&event_type=eq.view&select=id`, req) : 0;
}

module.exports = { insertMission, listMissions, getMission, claimMission, updateMission, adminListActiveMissions, adminPageMetrics, adminValidationCount, adminListOrders, adminWorkspaceTokens, adminTokensSince, adminGetSubscription, adminListOperatorWorkspaces, insertOperatorRun, updateOperatorRun, adminLatestOperatorRun, listOperatorRuns, getPaymentConnection, savePaymentConnection, deletePaymentConnection, markPaymentSynced, listPaymentConnections, upsertOrders, listOrders, countPageViews, configured, hasSecret, rateLimitHit, publicConfig, verifyUser, listWorkspaces, createWorkspace, getWorkspace, saveWorkspace, renameWorkspace, deleteWorkspace, getSubscription, upsertSubscription, findSubscriptionByStripeId, adminListWorkspaces, adminSaveWorkspace, getSocialConnection, upsertSocialConnection, deleteSocialConnection, listValidation, createValidation, deleteValidation, getPublishedPage, getOwnerPage, publishPage, unpublishPage, captureLead, recordPageEvent, getPageStats, updateLead, insertAiUsage, workspaceAiTokens, adminGetWorkspace, adminListAutomatedWorkspaces };
