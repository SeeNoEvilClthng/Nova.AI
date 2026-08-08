function budgetStatus(state={},planCeiling=Infinity) {
  const rawLimit=Number(state.aiBudget?.tokenLimit),personalLimit=Number.isFinite(rawLimit)&&rawLimit>=25000?rawLimit:100000,ceiling=Number(planCeiling),limit=Math.min(personalLimit,Number.isFinite(ceiling)&&ceiling>=25000?ceiling:Infinity);
  const rawUsed=Number(state.aiUsage?.totalTokens),used=Number.isFinite(rawUsed)&&rawUsed>0?rawUsed:0;
  return {limit,used,paused:state.aiBudget?.paused===true,allowed:state.aiBudget?.paused!==true&&used<limit};
}

function assertAiBudget(state,planCeiling) {
  const status=budgetStatus(state,planCeiling);
  if(status.paused)throw Object.assign(new Error("AI runs are paused for this workspace. Resume them from AI Activity."),{status:429});
  if(status.used>=status.limit)throw Object.assign(new Error(`This workspace reached its ${status.limit.toLocaleString()} token limit. Raise the limit from AI Activity to continue.`),{status:429});
  return status;
}

module.exports={budgetStatus,assertAiBudget};
