const crypto=require("node:crypto");
const riskRules = [
  ["money", /\b(buy|purchase|payment|refund|price|pricing|budget|spend|invoice|contract)\b/i],
  ["communication", /\b(send|email|message|post|publish|social|outreach|customer|ad campaign)\b/i],
  ["production", /\b(deploy|production|delete|remove data|domain|release|ship code)\b/i]
];

function classifyRisk(task = {}) {
  const text = `${task.title || ""} ${task.handoff || ""}`.slice(0, 2500);
  const match = riskRules.find(([, pattern]) => pattern.test(text));
  return match ? { level:"gated", category:match[0], label:`Founder gate · ${match[0]}` } : { level:"safe", category:"internal", label:"Safe internal work" };
}

function normalizeEvidence(input = {}) {
  return {
    taskId:String(input.taskId || "").trim().slice(0, 120),
    summary:String(input.summary || "").trim().slice(0, 1200),
    source:String(input.source || "").trim().slice(0, 500),
    metric:String(input.metric || "").trim().slice(0, 80),
    value:String(input.value || "").trim().slice(0, 80)
  };
}

function verifyEvidence(input = {}) {
  const evidence=normalizeEvidence(input),missing=[];
  if(!evidence.taskId)missing.push("task");
  if(evidence.summary.length<30)missing.push("specific result summary");
  if(evidence.source.length<8)missing.push("traceable evidence source");
  if(evidence.metric.length<2)missing.push("metric");
  if(!evidence.value)missing.push("observed value");
  let score=0;
  if(evidence.summary.length>=30)score+=30;
  if(evidence.source.length>=8)score+=25;
  if(evidence.metric.length>=2&&evidence.value)score+=25;
  const traceable=/https?:\/\//i.test(evidence.source)||/screenshot|analytics|invoice|commit|interview|customer|dashboard|report|record/i.test(`${evidence.source} ${evidence.summary}`);
  if(traceable)score+=20;
  const status=score>=75&&missing.length===0?"verified":"needs_more_evidence";
  return {...evidence,score,status,missing,review:status==="verified"?"The result includes a specific outcome, a traceable evidence source, and a measurable observation.":`Nova needs ${missing.length?missing.join(", "):"a traceable source"} before this can count as a verified outcome.`};
}

function signReceipt(workspaceId,proof,secret){
  if(!secret)throw new Error("Execution receipt secret is required");
  const payload=[workspaceId,proof.id,proof.taskId,proof.status,proof.score,proof.createdAt].join("|");
  return crypto.createHmac("sha256",secret).update(payload).digest("hex");
}

function validReceipt(workspaceId,proof,secret){
  if(!proof?.receipt||!secret)return false;const expected=signReceipt(workspaceId,proof,secret),actual=String(proof.receipt);
  return actual.length===expected.length&&crypto.timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}

module.exports={classifyRisk,normalizeEvidence,verifyEvidence,signReceipt,validReceipt};
