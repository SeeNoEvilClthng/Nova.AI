(() => {
  const message = document.getElementById("publicBillingMessage");
  if (!message) return;
  fetch("/api/billing/status")
    .then(response => response.ok ? response.json() : Promise.reject(new Error("Billing status unavailable")))
    .then(status => {
      if (status.enabled && status.webhookReady) {
        message.textContent = "Secure subscription checkout is available. Choose a plan, create your account, and continue directly to Stripe.";
        return;
      }
      message.textContent = "Create your account for preview access. Paid checkout will appear here as soon as secure billing is activated.";
    })
    .catch(() => {
      message.textContent = "Create your account to preview Nova.Ai and review available plans.";
    });
})();
