const test=require("node:test");
const assert=require("node:assert/strict");
const {budgetStatus,assertAiBudget}=require("./ai-budget");

test("allows AI work below the workspace token ceiling",()=>{
  assert.deepEqual(budgetStatus({aiUsage:{totalTokens:1200},aiBudget:{tokenLimit:25000}}),{limit:25000,used:1200,paused:false,allowed:true});
});

test("blocks AI work when the founder pauses the workspace",()=>{
  assert.throws(()=>assertAiBudget({aiBudget:{paused:true}}),error=>error.status===429&&/paused/.test(error.message));
});

test("blocks AI work after the workspace reaches its token ceiling",()=>{
  assert.throws(()=>assertAiBudget({aiUsage:{totalTokens:25000},aiBudget:{tokenLimit:25000}}),error=>error.status===429&&/25,000 token limit/.test(error.message));
});
test("a subscription ceiling overrides a higher personal limit",()=>{assert.equal(budgetStatus({aiBudget:{tokenLimit:1000000}},100000).limit,100000);});
