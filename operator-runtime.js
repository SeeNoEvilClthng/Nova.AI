// Production wiring for the Autonomous Operator (see operator.js).
const supabase = require("./supabase");
const router = require("./router");
const billing = require("./billing");
const { PLAN_RULES } = require("./entitlements");
const { assertAiBudget } = require("./ai-budget");
const { usageLedger } = require("./ai-access");
const { syncWorkspaceRevenue } = require("./revenue-routes");
const { createOperator } = require("./operator");

module.exports = createOperator({
  supabase, router, ledger: usageLedger, syncRevenue: syncWorkspaceRevenue,
  billingEnabled: () => billing.status().enabled, planRules: PLAN_RULES, assertAiBudget,
  // Loaded on use so the Action Center can never affect how the operator loads.
  proposeActions: input => require("./action-routes").proposeOperatorActions(input)
});
