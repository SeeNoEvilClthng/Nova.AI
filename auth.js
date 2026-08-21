const authState = { config: null, session: null };
const sessionKey = "nova.supabase.session";
const selectedPlanKey = "nova.selectedPlan";
const selectedWorldKey = "nova.selectedWorld";
let authMode = "signin";
let sessionRefreshTimer = null;
let refreshPromise = null;

function authHeaders(extra = {}) {
  return authState.session?.access_token ? { ...extra, Authorization: `Bearer ${authState.session.access_token}` } : extra;
}

async function refreshSession() {
  if (!authState.session?.refresh_token) return false;
  if (!refreshPromise) refreshPromise = supabaseAuth("/auth/v1/token?grant_type=refresh_token", { refresh_token:authState.session.refresh_token }).then(session => { storeSession(session);return true; }).catch(() => { clearSession();return false; }).finally(() => { refreshPromise=null; });
  return refreshPromise;
}

async function ensureFreshSession() {
  const expiresAt=Number(authState.session?.expires_at||0)*1000;
  if (expiresAt && expiresAt-Date.now()<60_000) await refreshSession();
}

window.authFetch = async (url, options = {}) => {
  await ensureFreshSession();
  let response=await fetch(url,{...options,headers:authHeaders(options.headers||{})});
  if(response.status===401&&authState.config?.supabase.enabled&&await refreshSession())response=await fetch(url,{...options,headers:authHeaders(options.headers||{})});
  return response;
};

async function supabaseAuth(path, body) {
  const { url, publishableKey } = authState.config.supabase;
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || "Authentication failed");
  return result;
}

async function requestPasswordReset(email) {
  const redirectTo = `${location.origin}/`;
  return supabaseAuth(`/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email });
}

async function updatePassword(accessToken, password) {
  const { url, publishableKey } = authState.config.supabase;
  const response = await fetch(`${url}/auth/v1/user`, {
    method: "PUT",
    headers: { apikey: publishableKey, Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ password })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || "Could not update password");
  return result;
}

function recoveryToken() {
  const params = new URLSearchParams(location.hash.slice(1));
  return params.get("type") === "recovery" ? params.get("access_token") : null;
}

function strongPasswordError(password) {
  if (password.length < 12) return "Use at least 12 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) return "Include uppercase, lowercase, a number, and a symbol.";
  return "";
}

function showRecoveryForm() {
  const token = recoveryToken();
  if (!token) return false;
  document.body.classList.add("auth-required");
  document.querySelector(".auth-card h2").textContent = "Choose a new password.";
  document.querySelector(".auth-card > p").textContent = "Enter a secure password for your Nova.Ai account.";
  const emailInput = document.getElementById("authEmailInput");
  emailInput.closest("label").hidden = true;
  emailInput.disabled = true;
  document.getElementById("authPassword").autocomplete = "new-password";
  document.getElementById("authSubmit").textContent = "Update password";
  document.getElementById("authSubmit").value = "recover";
  document.querySelector(".auth-modes").hidden = true;
  document.getElementById("authPasswordHint").hidden = false;
  document.getElementById("authConsent").hidden = true;
  document.getElementById("forgotPassword").hidden = true;
  return true;
}

function setAuthMode(mode) {
  authMode = mode === "signup" ? "signup" : "signin";
  const signup = authMode === "signup";
  document.querySelectorAll("[data-auth-mode]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.authMode === authMode)));
  document.querySelector(".auth-card h2").textContent = signup ? "Create your founder workspace." : "Welcome back, founder.";
  document.querySelector(".auth-card > p").textContent = signup ? "Start with one company idea. Nova.Ai will guide you through the first focused milestone." : "Sign in to access your companies, launch plans and AI team.";
  const password = document.getElementById("authPassword");
  password.autocomplete = signup ? "new-password" : "current-password";
  password.minLength = signup ? 12 : 8;
  document.getElementById("authPasswordHint").hidden = !signup;
  document.getElementById("authConsent").hidden = !signup;
  document.getElementById("authSubmit").value = authMode;
  document.getElementById("authSubmit").textContent = signup ? "Create workspace →" : "Sign in →";
  document.getElementById("forgotPassword").hidden = signup;
  const message = document.getElementById("authMessage");
  message.textContent = "";
  message.style.color = "";
}

function storeSession(session) {
  authState.session = session;
  localStorage.setItem(sessionKey, JSON.stringify(session));
  clearTimeout(sessionRefreshTimer);
  const expiresAt=Number(session?.expires_at||0)*1000,delay=Math.max(10_000,expiresAt-Date.now()-60_000);
  if(expiresAt)sessionRefreshTimer=setTimeout(refreshSession,delay);
  document.body.classList.toggle("auth-required", !session);
  if (session?.user?.email) document.getElementById("authEmail").textContent = session.user.email;
}

function clearSession() {
  clearTimeout(sessionRefreshTimer);
  authState.session=null;
  localStorage.removeItem(sessionKey);
  document.body.classList.add("auth-required");
}

async function restoreSession() {
  let saved=null;
  try { saved=JSON.parse(localStorage.getItem(sessionKey)||"null"); } catch { clearSession(); }
  if (!saved?.refresh_token) return false;
  authState.session=saved;
  try {
    return await refreshSession();
  } catch {
    clearSession();
    return false;
  }
}

async function initializeAuth() {
  authState.config = await fetch("/api/config").then(response => response.json());
  if (!authState.config.supabase.enabled) {
    document.body.classList.add("local-mode");
    document.getElementById("authEmail").textContent = "Local development";
    return;
  }
  if (showRecoveryForm()) return;
  const params = new URLSearchParams(location.search);
  const chosenPlan = params.get("plan");
  const chosenWorld = params.get("world");
  if (["starter", "builder", "operator"].includes(chosenPlan)) localStorage.setItem(selectedPlanKey, chosenPlan);
  if (["company", "reseller"].includes(chosenWorld)) localStorage.setItem(selectedWorldKey, chosenWorld);
  setAuthMode(params.get("mode"));
  if (!(await restoreSession())) document.body.classList.add("auth-required");
}

window.authReady = initializeAuth();

document.getElementById("authForm").onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById("authSubmit");
  const message = document.getElementById("authMessage");
  const email = document.getElementById("authEmailInput").value.trim();
  const password = document.getElementById("authPassword").value;
  button.disabled = true; message.textContent = "";
  try {
    if (event.submitter?.value === "recover") {
      const passwordError = strongPasswordError(password);
      if (passwordError) throw new Error(passwordError);
      await updatePassword(recoveryToken(), password);
      localStorage.removeItem(sessionKey);
      history.replaceState(null, "", location.pathname);
      message.style.color = "#16815c";
      message.textContent = "Password updated. Reloading sign in…";
      setTimeout(() => location.reload(), 900);
      return;
    }
    const signup = authMode === "signup";
    if (signup) {
      const passwordError = strongPasswordError(password);
      if (passwordError) throw new Error(passwordError);
      if (!document.getElementById("authConsentInput").checked) throw new Error("Please agree to the Terms and acknowledge the Privacy Policy.");
    }
    const result = await supabaseAuth(signup ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password", { email, password });
    if (!result.access_token) {
      message.style.color = "#16815c";
      message.textContent = "Check your email to confirm the account, then sign in.";
      return;
    }
    storeSession(result);
    const selectedPlan = localStorage.getItem(selectedPlanKey);
    const selectedWorld = localStorage.getItem(selectedWorldKey);
    if (selectedPlan) localStorage.removeItem(selectedPlanKey);
    if (selectedWorld) localStorage.removeItem(selectedWorldKey);
    location.replace(selectedPlan ? "/?view=billing" : selectedWorld === "reseller" ? "/reseller-studio" : "/");
  } catch (error) { message.textContent = error.message; }
  finally { button.disabled = false; }
};

document.querySelectorAll("[data-auth-mode]").forEach(button => button.onclick = () => setAuthMode(button.dataset.authMode));

document.getElementById("forgotPassword").onclick = async () => {
  const emailInput = document.getElementById("authEmailInput");
  const email = emailInput.value.trim();
  const message = document.getElementById("authMessage");
  if (!email || !emailInput.checkValidity()) {
    message.textContent = "Enter your email address first.";
    emailInput.focus();
    return;
  }
  const button = document.getElementById("forgotPassword");
  button.disabled = true;
  message.textContent = "";
  try {
    await requestPasswordReset(email);
    message.style.color = "#16815c";
    message.textContent = "If that account exists, a password-reset email is on its way.";
  } catch (error) {
    message.style.color = "";
    message.textContent = error.message;
  } finally { button.disabled = false; }
};

document.getElementById("signOut").onclick = async () => {
  if (!authState.config?.supabase.enabled) return;
  try {
    await fetch(`${authState.config.supabase.url}/auth/v1/logout`, { method: "POST", headers: authHeaders({ apikey: authState.config.supabase.publishableKey }) });
  } finally {
    clearSession();
    location.reload();
  }
};
