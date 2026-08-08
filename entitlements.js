const PLAN_RULES={
  starter:{label:"Starter plan",workspaceLimit:1,tokenCeiling:100000},
  builder:{label:"Builder plan",workspaceLimit:5,tokenCeiling:500000},
  operator:{label:"Operator plan",workspaceLimit:null,tokenCeiling:2000000}
};

function resolveEntitlement({billingEnabled=false,subscription=null,user=null,now=Date.now()}={}){
  if(!billingEnabled)return {tier:"preview",label:"Founder preview access",workspaceLimit:5,tokenCeiling:250000,canGenerate:true,message:"Billing is not active yet, so preview access remains enabled without charging you."};
  if(subscription&&new Set(["active","trialing"]).has(subscription.status)&&PLAN_RULES[subscription.tier])return {tier:subscription.tier,...PLAN_RULES[subscription.tier],canGenerate:true,message:subscription.current_period_end?`${subscription.cancel_at_period_end?"Access ends":"Renews"} ${new Date(subscription.current_period_end).toLocaleDateString()}.`:"Your subscription is active."};
  const created=Date.parse(user?.created_at||""),trialEnd=Number.isFinite(created)?created+14*86400000:now,days=Math.max(0,Math.ceil((trialEnd-now)/86400000));
  if(now<trialEnd)return {tier:"trial",label:"14-day Builder trial",workspaceLimit:1,tokenCeiling:100000,canGenerate:true,trialEndsAt:new Date(trialEnd).toISOString(),message:`${days} day${days===1?"":"s"} remaining. No charge until you choose a plan.`};
  return {tier:"expired",label:"Trial complete",workspaceLimit:1,tokenCeiling:25000,canGenerate:false,message:"Choose a plan to run AI employees again. Your saved company data remains available."};
}

function assertGenerationAccess(access){if(!access.canGenerate)throw Object.assign(new Error("Your trial is complete. Choose a Nova.Ai plan to run AI employees again."),{status:402});return access;}
function assertWorkspaceAccess(access,currentCount){if(access.workspaceLimit!==null&&currentCount>=access.workspaceLimit)throw Object.assign(new Error(`${access.label} includes ${access.workspaceLimit} active compan${access.workspaceLimit===1?"y":"ies"}. Upgrade to create another.`),{status:402});return access;}

module.exports={PLAN_RULES,resolveEntitlement,assertGenerationAccess,assertWorkspaceAccess};
