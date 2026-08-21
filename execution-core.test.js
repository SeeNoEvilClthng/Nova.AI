const test=require("node:test");
const assert=require("node:assert/strict");
const {classifyRisk,verifyEvidence,signReceipt,validReceipt}=require("./execution-core");

test("holds external and financial actions behind founder gates",()=>{
  assert.deepEqual(classifyRisk({title:"Send the customer outreach emails"}),{level:"gated",category:"communication",label:"Founder gate · communication"});
  assert.equal(classifyRisk({title:"Purchase an ad campaign"}).level,"gated");
  assert.equal(classifyRisk({title:"Analyze interview themes"}).level,"safe");
});

test("rejects vague completion claims without evidence",()=>{
  const result=verifyEvidence({taskId:"task-1",summary:"Done",source:"none",metric:"",value:""});
  assert.equal(result.status,"needs_more_evidence");
  assert.ok(result.score<75);
  assert.ok(result.missing.includes("specific result summary"));
});

test("verifies specific measurable results with a traceable source",()=>{
  const result=verifyEvidence({taskId:"task-1",summary:"Seven qualified founders completed the onboarding flow during the launch test.",source:"https://analytics.example.test/report/launch",metric:"Qualified signups",value:"7"});
  assert.equal(result.status,"verified");
  assert.equal(result.score,100);
  assert.deepEqual(result.missing,[]);
});

test("detects a changed verification receipt",()=>{
  const proof={id:"proof-1",taskId:"task-1",status:"verified",score:100,createdAt:"2026-08-11T12:00:00.000Z"};
  proof.receipt=signReceipt("workspace-1",proof,"test-secret");
  assert.equal(validReceipt("workspace-1",proof,"test-secret"),true);
  assert.equal(validReceipt("workspace-1",{...proof,score:75},"test-secret"),false);
});
