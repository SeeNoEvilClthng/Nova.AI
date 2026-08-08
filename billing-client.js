(() => {
  const buttons = [...document.querySelectorAll(".plan-button")];
  const stateLabel = document.getElementById("billingState");
  const currentPlan = document.getElementById("currentPlan");
  const currentPlanDetail = document.getElementById("currentPlanDetail");
  const manageButton = document.getElementById("manageBilling");

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
      stateLabel.textContent = status.enabled ? (status.webhookReady ? "Test billing ready" : "Checkout ready · webhook pending") : "Test billing not connected";
      stateLabel.classList.toggle("ready", status.enabled && status.webhookReady);
      buttons.forEach(button => { button.disabled = !status.enabled || !status.availablePlans.includes(button.dataset.plan); });
      const subscription = subscriptionResult.subscription,entitlement=subscriptionResult.entitlement;
      if(entitlement){window.novaEntitlement=entitlement;window.dispatchEvent(new CustomEvent("nova-entitlement"));currentPlan.textContent=entitlement.label;currentPlanDetail.textContent=entitlement.message;document.getElementById("entitlementBenefits").innerHTML=`<span>${entitlement.workspaceLimit===null?"Unlimited":entitlement.workspaceLimit} compan${entitlement.workspaceLimit===1?"y":"ies"}</span><span>${Number(entitlement.tokenCeiling).toLocaleString()} token ceiling</span><span>${entitlement.canGenerate?"AI employees enabled":"Upgrade required"}</span>`;}
      if (subscription) {
        manageButton.hidden = !subscription.stripe_customer_id;
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
