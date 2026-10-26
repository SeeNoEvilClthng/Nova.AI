// Shared pre-generation gate for every route that spends AI tokens, including
// the durable-mission routes in src/index.ts.
const supabase = require("./supabase");
const database = require("./database");
const billing = require("./billing");
const entitlements = require("./entitlements");
const { assertAiBudget } = require("./ai-budget");
const usageLedger = require("./ai-usage").createUsageLedger({ supabase, database });

async function accountEntitlement(req,user) {
  if(!supabase.configured())return entitlements.resolveEntitlement({billingEnabled:false});
  const subscription=await supabase.getSubscription(req);
  return entitlements.resolveEntitlement({billingEnabled:billing.status().enabled,subscription,user});
}

async function enforceAiBudget(req, workspaceId, planCeiling) {
  const id=String(workspaceId||"").trim();
  if(!id)throw Object.assign(new Error("Workspace is required for AI generation"),{status:400});
  const workspace=supabase.configured()?await supabase.getWorkspace(req,id):database.getWorkspace(id);
  if(!workspace)throw Object.assign(new Error("Workspace not found"),{status:404});
  assertAiBudget(workspace.state,planCeiling,await usageLedger.workspaceTokens(req,id));
}

async function assertCanGenerate(req,user,workspaceId) {
  const access=entitlements.assertGenerationAccess(await accountEntitlement(req,user));
  await enforceAiBudget(req,workspaceId,access.tokenCeiling);
  return access;
}

module.exports = { usageLedger, accountEntitlement, enforceAiBudget, assertCanGenerate };
