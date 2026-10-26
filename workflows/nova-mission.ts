import { createHook } from "workflow";
import missionAgents from "../mission-agents.js";

export type NovaMissionInput={missionId:string;workspaceId:string;userId?:string|null;company:string;objective:string};
export type FounderDecision={approved:boolean;comment:string};
type MissionStep={agent:string;status:string;output:string;details?:Record<string,unknown>;contribution?:Record<string,unknown>;warnings?:string[]};

// Each stage is a durable step: the workflow runtime persists its result and
// retries it on failure, so a crash or timeout resumes instead of restarting.
async function strategyStep(input:NovaMissionInput):Promise<MissionStep>{
  "use step";
  return missionAgents.runMissionStage("strategy",input);
}

async function researchStep(input:NovaMissionInput,prior:MissionStep[]):Promise<MissionStep>{
  "use step";
  return missionAgents.runMissionStage("research",input,prior);
}

async function buildStep(input:NovaMissionInput,prior:MissionStep[]):Promise<MissionStep>{
  "use step";
  return missionAgents.runMissionStage("build",input,prior);
}

async function saveProgressStep(input:NovaMissionInput,steps:MissionStep[],stage:string){
  "use step";
  return missionAgents.saveMissionProgress(input,steps,stage);
}

async function executeStep(input:NovaMissionInput,decision:FounderDecision):Promise<MissionStep>{
  "use step";
  return {agent:"Operations",status:"prepared",output:`Founder approved execution${decision.comment?`: ${decision.comment}`:""}. Connected-tool execution is ready but remains disabled until the required account is connected.`};
}

async function reviewStep(input:NovaMissionInput,prior:MissionStep[]):Promise<MissionStep>{
  "use step";
  return missionAgents.runMissionStage("review",input,prior);
}

export async function novaMissionWorkflow(input:NovaMissionInput){
  "use workflow";
  const steps:MissionStep[]=[];
  steps.push(await strategyStep(input));
  steps.push(await researchStep(input,steps));
  steps.push(await buildStep(input,steps));
  using approval=createHook<FounderDecision>({token:`nova-mission:${input.missionId}:approval`});
  await saveProgressStep(input,steps,"awaiting_approval");
  const decision=await approval;
  if(!decision.approved)return {missionId:input.missionId,status:"rejected",steps,decision};
  steps.push(await executeStep(input,decision));
  steps.push(await reviewStep(input,steps));
  await saveProgressStep(input,steps,"reviewed");
  return {missionId:input.missionId,status:"completed",steps,decision};
}
