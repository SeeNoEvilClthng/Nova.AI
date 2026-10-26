// Specialist agents for durable missions. Each stage makes a real model call
// (or returns a clearly labelled template when no model is configured) and is
// metered in the AI usage ledger. Stages only draft internal work: nothing here
// contacts customers, publishes, spends, or deploys.
const router = require("./router");
const { usageLedger } = require("./ai-access");

const schema = {
  type: "object", additionalProperties: false, required: ["summary", "outputs", "assumptions", "nextStep"],
  properties: {
    summary: { type: "string", maxLength: 600 },
    outputs: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 6 },
    assumptions: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 4 },
    nextStep: { type: "string", maxLength: 300 }
  }
};

const guardrail = "Use only the mission context provided. You have no web access and have contacted no one: never claim research, outreach, publishing, spending, or deployment happened. Label every unverified belief as an assumption. Return one JSON object matching the schema.";

const stages = {
  strategy: {
    agent: "Strategy",
    instructions: `You are Nova.Ai's Strategy Agent. Turn the founder's objective into one measurable mission: the target metric, its baseline if known, the target value, a deadline, and a stop condition. ${guardrail}`,
    template: input => ({ summary: `Template: convert "${input.objective}" into one measurable mission with a founder-controlled execution boundary.`, outputs: ["Define the target metric, baseline, target value and deadline", "Agree a stop condition before any spend"], assumptions: ["No model is configured, so this is a fixed template rather than AI analysis"], nextStep: "Research the riskiest assumption." })
  },
  research: {
    agent: "Research",
    instructions: `You are Nova.Ai's Market Research Agent. Using the strategy, list the riskiest assumptions and, for each, the specific evidence that would confirm or refute it and where a founder could obtain it (named source types, interview questions, or metrics). This is a research plan, not findings. ${guardrail}`,
    template: () => ({ summary: "Template: evidence checklist for the mission.", outputs: ["Customer signal to collect", "Baseline metric and its source of truth", "Target result", "Stop condition"], assumptions: ["No model is configured, so this is a fixed template rather than AI analysis"], nextStep: "Package the smallest executable work." })
  },
  build: {
    agent: "Builder",
    instructions: `You are Nova.Ai's Builder Agent. Using the strategy and research plan, define the smallest executable work package: concrete tasks, acceptance criteria, which tasks need external tools or founder approval, and what evidence will prove completion. ${guardrail}`,
    template: () => ({ summary: "Template: smallest executable work package with acceptance criteria. No external system was changed.", outputs: ["List tasks with owners", "Write acceptance criteria", "Flag tasks that need founder approval"], assumptions: ["No model is configured, so this is a fixed template rather than AI analysis"], nextStep: "Founder reviews and approves or rejects the package." })
  },
  review: {
    agent: "Reviewer",
    instructions: `You are Nova.Ai's independent Compliance and Quality Agent. Audit the mission's drafted work for a measurable target, an approval record, evidence requirements, unsupported claims, and legal or reputational risk. List concrete problems; do not rewrite the work. ${guardrail}`,
    template: () => ({ summary: "Template review: confirm the mission kept a measurable target, an approval record and an evidence requirement. External execution was not claimed.", outputs: [], assumptions: ["No model is configured, so this is a fixed template rather than AI review"], nextStep: "Execute approved tasks with connected tools and record evidence." })
  }
};

async function runMissionStage(stage, input, priorSteps = []) {
  const definition = stages[stage];
  if (!definition) throw new Error(`Unknown mission stage: ${stage}`);
  const context = { company: input.company, objective: input.objective, priorWork: priorSteps.map(step => ({ agent: step.agent, summary: step.output, outputs: step.details?.outputs || [] })) };
  const { result, contribution, warnings } = await router.generateAgentTask(context, definition.template.bind(null, input), schema, { role: `${definition.agent} Agent`, schemaName: `mission_${stage}`, instructions: definition.instructions });
  await usageLedger.record(contribution, { workspaceId: input.workspaceId, userId: input.userId, operation: `mission-${stage}` });
  const templated = contribution.model === "Demo engine";
  return {
    agent: definition.agent,
    // "drafted" = AI-generated internal work awaiting review; "template" =
    // fixed text because no model was available. Neither means executed.
    status: templated ? "template" : "drafted",
    output: String(result.summary || ""),
    details: { outputs: result.outputs || [], assumptions: result.assumptions || [], nextStep: result.nextStep || "" },
    contribution: { id: contribution.id, provider: contribution.provider, model: contribution.model, usage: contribution.usage, latencyMs: contribution.latencyMs },
    warnings
  };
}

module.exports = { runMissionStage, stages };
