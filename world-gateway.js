(() => {
  const gateway = document.getElementById("worldGateway");
  const switcher = document.getElementById("worldSwitcher");
  const company = document.querySelector('[data-world="company"]');
  const reseller = document.querySelector('[data-world="reseller"]');
  if (!gateway || !company) return;

  const sessionKey = "nova.supabase.session";
  const params = new URLSearchParams(location.search);
  const forceChoice = params.get("choose") === "1" || params.get("worlds") === "1";

  function isSignedIn() {
    try {
      const session = JSON.parse(localStorage.getItem(sessionKey) || "null");
      return Boolean(session?.access_token || session?.refresh_token);
    } catch {
      return false;
    }
  }

  function hide() {
    gateway.classList.add("is-hidden");
    gateway.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  function show() {
    gateway.classList.remove("is-hidden");
    gateway.removeAttribute("aria-hidden");
    document.body.style.overflow = "hidden";
  }

  function remember(world) {
    localStorage.setItem("nova.lastWorld", world);
  }

  company.addEventListener("click", () => {
    remember("company");
    if (isSignedIn()) location.assign("/");
    else hide();
  });

  reseller?.addEventListener("click", event => {
    remember("reseller");
    if (isSignedIn()) {
      event.preventDefault();
      location.assign("/reseller-studio");
    }
  });
  switcher?.addEventListener("click", show);

  // An explicit world-choice URL always wins, even for returning signed-in users.
  // The gateway also opens on normal /welcome visits so no remembered world traps
  // someone on one side of Nova.Ai.
  if (forceChoice || location.pathname === "/welcome") show();
  else hide();
})();
