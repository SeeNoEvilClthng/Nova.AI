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
  const rows = await publicRequest(`/rest/v1/nova_published_pages?slug=eq.${encodeURIComponent(slug)}&published=eq.true&select=id,slug,title,snapshot,published_at&limit=1`);
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

async function captureLead(pageId, email) {
  return publicRequest("/rest/v1/nova_page_leads", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ page_id:pageId, email }) });
}

async function recordPageEvent(pageId, eventType) {
  return publicRequest("/rest/v1/nova_page_events", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ page_id:pageId, event_type:eventType }) });
}

async function getPageStats(req, pageId) {
  const [events, leads] = await Promise.all([
    request(`/rest/v1/nova_page_events?page_id=eq.${encodeURIComponent(pageId)}&select=event_type`, req),
    request(`/rest/v1/nova_page_leads?page_id=eq.${encodeURIComponent(pageId)}&select=id,email,status,created_at,updated_at&order=created_at.desc`, req)
  ]);
  return { views:events.filter(e=>e.event_type==="view").length, signups:leads.length, leads };
}

async function updateLead(req, id, status) {
  const rows = await request(`/rest/v1/nova_page_leads?id=eq.${encodeURIComponent(id)}&select=id,email,status,created_at,updated_at`, req, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() })
  });
  return rows[0] || null;
}

module.exports = { configured, publicConfig, verifyUser, listWorkspaces, createWorkspace, getWorkspace, saveWorkspace, renameWorkspace, deleteWorkspace, getSubscription, upsertSubscription, findSubscriptionByStripeId, adminListWorkspaces, adminSaveWorkspace, getSocialConnection, upsertSocialConnection, deleteSocialConnection, listValidation, createValidation, deleteValidation, getPublishedPage, getOwnerPage, publishPage, unpublishPage, captureLead, recordPageEvent, getPageStats, updateLead };
