(() => {
  const buttons = [...document.querySelectorAll(".plan-button")];
  const stateLabel = document.getElementById("billingState");
  const currentPlan = document.getElementById("currentPlan");
  const currentPlanDetail = document.getElementById("currentPlanDetail");
  const manageButton = document.getElementById("manageBilling");
  let checkoutStarted = false;

  async function request(path, options) {
    const response = await authFetch(path, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Billing request failed");
    return result;
  }

  async function loadBilling() {
    try {
      const [statusResponse, subscriptionResult] = await Promise.all([fetch("/api/billing/status"), request("/api/billing/subscription")]);
      const status = await statusResponse.json();
      stateLabel.textContent = status.enabled ? (status.webhookReady ? `${status.mode === "live" ? "Live" : "Test"} billing ready` : "Checkout ready · webhook pending") : "Billing not connected";
      stateLabel.classList.toggle("ready", status.enabled && status.webhookReady);
      buttons.forEach(button => { button.disabled = !status.enabled || !status.availablePlans.includes(button.dataset.plan); });
      const subscription = subscriptionResult.subscription,entitlement=subscriptionResult.entitlement;
      if(entitlement){window.novaEntitlement=entitlement;window.dispatchEvent(new CustomEvent("nova-entitlement"));currentPlan.textContent=entitlement.label;currentPlanDetail.textContent=entitlement.message;document.getElementById("entitlementBenefits").innerHTML=`<span>${entitlement.workspaceLimit===null?"Unlimited":entitlement.workspaceLimit} compan${entitlement.workspaceLimit===1?"y":"ies"}</span><span>${Number(entitlement.tokenCeiling).toLocaleString()} token ceiling</span><span>${entitlement.canGenerate?"AI employees enabled":"Upgrade required"}</span>`;}
      if (subscription) {
        manageButton.hidden = !subscription.stripe_customer_id;
      }
      const requestedPlan = new URLSearchParams(location.search).get("checkout");
      if (!checkoutStarted && ["starter", "builder", "operator"].includes(requestedPlan)) {
        checkoutStarted = true;
        const cleanUrl = new URL(location.href);
        cleanUrl.searchParams.delete("checkout");
        history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
        if (!status.enabled || !status.availablePlans.includes(requestedPlan)) {
          toast("Checkout is not available for that plan yet. Your selection is still shown here.");
        } else if (subscription && ["active", "trialing"].includes(subscription.status)) {
          toast("You already have an active subscription. Use Manage subscription to make changes.");
        } else {
          const button = buttons.find(item => item.dataset.plan === requestedPlan);
          if (button) button.click();
        }
      }
    } catch (error) { stateLabel.textContent = error.message; }
  }

  buttons.forEach(button => button.addEventListener("click", async () => {
    button.disabled = true;
    try { const result = await request("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: button.dataset.plan }) }); location.href = result.url; }
    catch (error) { toast(error.message); button.disabled = false; }
  }));
  manageButton.addEventListener("click", async () => {
    manageButton.disabled = true;
    try { const result = await request("/api/billing/portal", { method: "POST" }); location.href = result.url; }
    catch (error) { toast(error.message); manageButton.disabled = false; }
  });
  window.loadBilling = loadBilling;
  window.authReady.then(loadBilling);
  if (new URLSearchParams(location.search).has("billing")) setTimeout(() => { show("billing"); loadBilling(); }, 0);
})();
