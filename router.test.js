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
