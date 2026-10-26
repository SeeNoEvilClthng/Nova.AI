// meteredTokens comes from the server-side usage ledger. The client-saved
// state can never report less usage than the ledger has recorded.
function budgetStatus(state={},planCeiling=Infinity,meteredTokens=0) {
  const rawLimit=Number(state.aiBudget?.tokenLimit),personalLimit=Number.isFinite(rawLimit)&&rawLimit>=25000?rawLimit:100000,ceiling=Number(planCeiling),limit=Math.min(personalLimit,Number.isFinite(ceiling)&&ceiling>=25000?ceiling:Infinity);
  const rawUsed=Number(state.aiUsage?.totalTokens),stateUsed=Number.isFinite(rawUsed)&&rawUsed>0?rawUsed:0,metered=Number(meteredTokens),used=Math.max(stateUsed,Number.isFinite(metered)&&metered>0?metered:0);
  return {limit,used,paused:state.aiBudget?.paused===true,allowed:state.aiBudget?.paused!==true&&used<limit};
}

// Saved state may add usage but never erase it (for example a client that
// resets its counters when it regenerates a strategy).
function preserveUsage(existing,incoming) {
  const before=Number(existing?.totalTokens)||0,after=Number(incoming?.totalTokens)||0;
  return after>=before?incoming:existing;
}

function assertAiBudget(state,planCeiling,meteredTokens) {
  const status=budgetStatus(state,planCeiling,meteredTokens);
  if(status.paused)throw Object.assign(new Error("AI runs are paused for this workspace. Resume them from AI Activity."),{status:429});
  if(status.used>=status.limit)throw Object.assign(new Error(`This workspace reached its ${status.limit.toLocaleString()} token limit. Raise the limit from AI Activity to continue.`),{status:429});
  return status;
}

module.exports={budgetStatus,assertAiBudget,preserveUsage};
