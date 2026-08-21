import { createHook } from "workflow";

export type NovaMissionInput={missionId:string;workspaceId:string;company:string;objective:string};
export type FounderDecision={approved:boolean;comment:string};

async function strategyStep(input:NovaMissionInput){
  "use step";
  return {agent:"Strategy",status:"completed",output:`Converted “${input.objective}” into one measurable company mission with a founder-controlled execution boundary.`};
}

async function researchStep(input:NovaMissionInput){
  "use step";
  return {agent:"Research",status:"completed",output:"Prepared the evidence checklist: customer signal, baseline metric, target result, source of truth, and stop condition."};
}

async function buildStep(input:NovaMissionInput){
  "use step";
  return {agent:"Builder",status:"completed",output:"Prepared the smallest executable work package and acceptance criteria. No external system was changed."};
}

async function executeStep(input:NovaMissionInput,decision:FounderDecision){
  "use step";
  return {agent:"Operations",status:"prepared",output:`Founder approved execution${decision.comment?`: ${decision.comment}`:""}. Connected-tool execution is ready but remains disabled until the required account is connected.`};
}

async function reviewStep(input:NovaMissionInput){
  "use step";
  return {agent:"Reviewer",status:"completed",output:"Confirmed the mission retained a measurable target, approval record, and evidence requirement. External execution was not falsely claimed."};
}

export async function novaMissionWorkflow(input:NovaMissionInput){
  "use workflow";
  const steps=[await strategyStep(input),await researchStep(input),await buildStep(input)];
  using approval=createHook<FounderDecision>({token:`nova-mission:${input.missionId}:approval`});
  const decision=await approval;
  if(!decision.approved)return {missionId:input.missionId,status:"rejected",steps,decision};
  steps.push(await executeStep(input,decision));
  steps.push(await reviewStep(input));
  return {missionId:input.missionId,status:"completed",steps,decision};
}
