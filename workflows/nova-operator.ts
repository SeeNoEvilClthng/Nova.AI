import operator from "../operator-runtime.js";

export type OperatorInput={workspaceId:string;trigger:"manual"|"scheduled"};
type Run={runId:string;workspaceId:string;userId:string;mode:string;skip:string|null};

// Each stage is a durable, retried step, so a timeout or crash resumes the
// cycle instead of losing it, and the cycle runs outside the request path.
async function startStep(input:OperatorInput):Promise<Run>{
  "use step";
  return operator.startRun(input);
}

async function collectStep(run:Run){
  "use step";
  return operator.collect({workspaceId:run.workspaceId});
}

async function briefStep(run:Run,context:any){
  "use step";
  return operator.brief({workspaceId:run.workspaceId,userId:run.userId,context});
}

async function draftStep(run:Run,context:any,brief:any){
  "use step";
  return operator.draftInternalWork({workspaceId:run.workspaceId,userId:run.userId,mode:run.mode,context,brief});
}

async function finishStep(runId:string,values:Record<string,unknown>){
  "use step";
  return operator.finish({runId,values});
}

export async function novaOperatorWorkflow(input:OperatorInput){
  "use workflow";
  const run=await startStep(input);
  if(run.skip)return {runId:run.runId,status:"skipped",reason:run.skip};
  try{
    const context=await collectStep(run);
    const briefing=await briefStep(run,context);
    const drafting=await draftStep(run,context,briefing.brief);
    await finishStep(run.runId,{status:"completed",metrics:context.metrics,brief:{...briefing.brief,warnings:[...context.warnings,...briefing.warnings]},drafts:drafting.drafts,model:briefing.model,tokens:briefing.tokens+drafting.tokens});
    return {runId:run.runId,status:"completed"};
  }catch(error:any){
    await finishStep(run.runId,{status:"failed",error:String(error?.message||error).slice(0,300)});
    return {runId:run.runId,status:"failed"};
  }
}
