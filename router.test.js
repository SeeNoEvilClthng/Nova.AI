const test = require("node:test");
const assert = require("node:assert/strict");
const router = require("./router");

test("uses the safe demo engine when no model credentials are available", async () => {
  const original = {
    openai: process.env.OPENAI_API_KEY,
    gateway: process.env.AI_GATEWAY_API_KEY,
    oidc: process.env.VERCEL_OIDC_TOKEN
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.VERCEL_OIDC_TOKEN;
  try {
    const result = await router.generate(
      { idea: "A customer research workspace", customer: "Independent software founders" },
      input => ({
        name: "Research Workspace",
        customer: input.customer,
        offer: "A focused workspace that turns founder interviews into clear, prioritized product evidence.",
        revenue: "Monthly subscription",
        milestone: "Complete 10 customer interviews and recruit 3 design partners.",
        positioning: "Evidence-led planning for independent software founders.",
        review: "Willingness to pay is still unproven, so validate pricing directly before expanding the product.",
        goal: "Validate the idea"
      }),
      {}
    );
    assert.equal(result.contributions[0].model, "Demo engine");
    assert.equal(result.evaluation.score, 100);
  } finally {
    if (original.openai) process.env.OPENAI_API_KEY = original.openai;
    if (original.gateway) process.env.AI_GATEWAY_API_KEY = original.gateway;
    if (original.oidc) process.env.VERCEL_OIDC_TOKEN = original.oidc;
  }
});

test("coordinates employee deliverables through the demo workforce", async () => {
  const original = { openai:process.env.OPENAI_API_KEY,gateway:process.env.AI_GATEWAY_API_KEY,oidc:process.env.VERCEL_OIDC_TOKEN };
  delete process.env.OPENAI_API_KEY;delete process.env.AI_GATEWAY_API_KEY;delete process.env.VERCEL_OIDC_TOKEN;
  try {
    const result = await router.generateWorkforce(
      { goal:"Recruit five paying design partners" },
      input => ({ summary:`Team assigned: ${input.goal}`,needsApproval:true,employees:[{ role:"Growth Employee",department:"Marketing",status:"completed",deliverable:"Draft outreach",handoff:"Founder review" }] }),
      {}
    );
    assert.equal(result.employees.length, 1);
    assert.equal(result.needsApproval, true);
    assert.equal(result.contribution.role, "Workforce Orchestrator");
  } finally {
    if(original.openai)process.env.OPENAI_API_KEY=original.openai;if(original.gateway)process.env.AI_GATEWAY_API_KEY=original.gateway;if(original.oidc)process.env.VERCEL_OIDC_TOKEN=original.oidc;
  }
});

test("persists orchestrator and independent reviewer contributions in fallback mode", async () => {
  const original = { openai:process.env.OPENAI_API_KEY,gateway:process.env.AI_GATEWAY_API_KEY,oidc:process.env.VERCEL_OIDC_TOKEN };
  delete process.env.OPENAI_API_KEY;delete process.env.AI_GATEWAY_API_KEY;delete process.env.VERCEL_OIDC_TOKEN;
  try {
    const result = await router.generateWorkforce(
      { goal:"Prepare a measurable launch plan" },
      () => ({ summary:"Team plan",needsApproval:true,employees:[{ role:"Growth Employee",department:"Marketing",status:"completed",deliverable:"Draft outreach",handoff:"Founder review" }] }),
      {},
      { schema:{},fallback:() => ({ score:78,verdict:"Revise",ready:false,strengths:["Clear owner"],blockers:["Add a conversion target"],recommendation:"Define the target before approval." }) }
    );
    assert.equal(result.review.score, 78);
    assert.equal(result.contributions.length, 2);
    assert.deepEqual(result.contributions.map(item => item.role), ["Workforce Orchestrator", "Reviewer Agent"]);
    assert.ok(result.contributions.every(item => item.model === "Demo engine"));
  } finally {
    if(original.openai)process.env.OPENAI_API_KEY=original.openai;if(original.gateway)process.env.AI_GATEWAY_API_KEY=original.gateway;if(original.oidc)process.env.VERCEL_OIDC_TOKEN=original.oidc;
  }
});

test("configures a current free model fallback without duplicating the primary", () => {
  const original = {
    openai: process.env.OPENAI_API_KEY,
    primary: process.env.AI_GATEWAY_MODEL,
    fallbacks: process.env.AI_GATEWAY_FALLBACK_MODELS
  };
  delete process.env.OPENAI_API_KEY;
  process.env.AI_GATEWAY_MODEL = "inclusionai/ling-3.0-tiny-free";
  process.env.AI_GATEWAY_FALLBACK_MODELS = "inclusionai/ling-3.0-tiny-free, poolside/laguna-s-2.1-free, invalid";
  try {
    assert.deepEqual(router.gatewayFallbackModels(), ["poolside/laguna-s-2.1-free"]);
    const routing = router.gatewayRouting({ userId:"founder-1", workspaceId:"company-1", schemaName:"launch_plan" });
    assert.deepEqual(routing.models, ["poolside/laguna-s-2.1-free"]);
    assert.equal(routing.user, "founder-1");
    assert.deepEqual(routing.tags, ["app:nova-ai", "output:launch_plan", "workspace:company-1"]);
  } finally {
    if (original.openai === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = original.openai;
    if (original.primary === undefined) delete process.env.AI_GATEWAY_MODEL; else process.env.AI_GATEWAY_MODEL = original.primary;
    if (original.fallbacks === undefined) delete process.env.AI_GATEWAY_FALLBACK_MODELS; else process.env.AI_GATEWAY_FALLBACK_MODELS = original.fallbacks;
  }
});

test("creates a safe reseller listing fallback from verified facts only", () => {
  const kit=router.fallbackResellerListing({name:"Leather shoulder bag",category:"Accessories",condition:"Good",channel:"Nova showroom",price:85,quantity:1,description:"Brown leather bag with adjustable strap and visible wear on the corners."});
  assert.equal(kit.title,"Good Leather shoulder bag");
  assert.match(kit.description,/visible wear on the corners/);
  assert.match(kit.pricingGuidance,/seller-set price/);
  assert.ok(kit.reviewWarnings.some(item=>item.includes("Confirm")));
  assert.ok(!kit.description.toLowerCase().includes("authentic"));
});

test("returns a reviewable reseller listing kit when model credentials are unavailable", async () => {
  const original={openai:process.env.OPENAI_API_KEY,gateway:process.env.AI_GATEWAY_API_KEY,oidc:process.env.VERCEL_OIDC_TOKEN};
  delete process.env.OPENAI_API_KEY;delete process.env.AI_GATEWAY_API_KEY;delete process.env.VERCEL_OIDC_TOKEN;
  try{
    const result=await router.generateResellerListing({product:{name:"Desk lamp",category:"Lighting",condition:"Like new",channel:"Etsy",price:42,quantity:1,description:"Black metal lamp tested with a working dimmer switch."}});
    assert.equal(result.contribution.role,"Reseller Listing Agent");
    assert.equal(result.contribution.model,"Demo engine");
    assert.equal(result.kit.tags.length,4);
    assert.match(result.kit.socialCaption,/Desk lamp/);
  }finally{
    if(original.openai===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original.openai;
    if(original.gateway===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=original.gateway;
    if(original.oidc===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=original.oidc;
  }
});

test("creates an approval-only campaign fallback from verified product facts", async () => {
  const original={openai:process.env.OPENAI_API_KEY,gateway:process.env.AI_GATEWAY_API_KEY,oidc:process.env.VERCEL_OIDC_TOKEN};delete process.env.OPENAI_API_KEY;delete process.env.AI_GATEWAY_API_KEY;delete process.env.VERCEL_OIDC_TOKEN;
  try{const result=await router.generateResellerCampaign({goal:"Introduce this item to collectors",product:{name:"Sealed fragrance",category:"Fragrance",condition:"New",price:190,quantity:2,description:"Seller verified 70 mL bottle in its sealed original box."}});assert.equal(result.contribution.role,"Nova Campaign Copilot");assert.equal(result.contribution.model,"Demo engine");assert.match(result.campaign.caption,/Sealed fragrance/);assert.doesNotMatch(result.campaign.caption,/authentic/i);assert.ok(result.campaign.reviewWarnings.length>0)}finally{if(original.openai===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original.openai;if(original.gateway===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=original.gateway;if(original.oidc===undefined)delete process.env.VERCEL_OIDC_TOKEN;else process.env.VERCEL_OIDC_TOKEN=original.oidc}
});
