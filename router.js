const registry = {
  openai: {
    label: "Vercel AI Gateway",
    role: "Founder Agent",
    model: () => process.env.OPENAI_API_KEY ? (process.env.OPENAI_MODEL || "gpt-5.6-sol") : (process.env.AI_GATEWAY_MODEL || "inclusionai/ling-3.0-flash-free"),
    ready: () => Boolean(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)
  },
  anthropic: { label: "Claude", role: "Auditor Agent", model: () => process.env.ANTHROPIC_MODEL || "Not activated", ready: () => Boolean(process.env.ANTHROPIC_API_KEY) },
  gemini: { label: "Gemini", role: "Research Agent", model: () => process.env.GEMINI_MODEL || "Not activated", ready: () => Boolean(process.env.GEMINI_API_KEY) }
};
const { randomUUID } = require("crypto");

function normalizeUsage(usage = {}) {
  const inputTokens = usage.inputTokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.outputTokens ?? usage.output_tokens ?? 0;
  return { inputTokens, outputTokens, totalTokens: usage.totalTokens ?? usage.total_tokens ?? inputTokens + outputTokens };
}

function providerStatus() {
  return Object.fromEntries(Object.entries(registry).map(([id, item]) => [id, {
    id, label: item.label, role: item.role, model: item.model(), ready: item.ready()
  }]));
}

function evaluatePlan(plan) {
  const checks = [
    ["Customer clarity", plan.customer?.length >= 12],
    ["Offer specificity", plan.offer?.length >= 50],
    ["Measurable milestone", /\d/.test(plan.milestone || "")],
    ["Revenue defined", Boolean(plan.revenue)],
    ["Independent challenge", plan.review?.length >= 60]
  ];
  const passed = checks.filter(([, result]) => result).length;
  return {
    score: Math.round((passed / checks.length) * 100),
    checks: checks.map(([label, pass]) => ({ label, pass })),
    verdict: passed === checks.length ? "Ready for founder review" : "Needs another pass"
  };
}

function parseGatewayJson(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gateway returned no JSON object");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function runOpenAI(input, schema, options = {}) {
  if (!registry.openai.ready()) return null;
  const model = registry.openai.model(), generationId = randomUUID();
  const { userId, workspaceId, ...promptInput } = input;
  const instructions = options.instructions || [
    "You are Nova.Ai's Founder Agent.",
    "Create a practical, specific launch plan grounded only in the founder's brief.",
    "Make the first milestone measurable and achievable before recommending expansion.",
    "Use the review field to challenge the single riskiest assumption and propose how to validate it.",
    "Never promise business success, invent customer evidence, or imply that research has already happened."
  ].join(" ");
  const role = options.role || registry.openai.role, schemaName = options.schemaName || "launch_plan";

  if (!process.env.OPENAI_API_KEY) {
    const { generateText } = await import("ai");
    const result = await generateText({
      model,
      system: instructions,
      prompt: `Founder brief:\n${JSON.stringify(promptInput, null, 2)}\n\nReturn only one valid JSON object matching this JSON Schema exactly. Do not use markdown or add commentary.\n${JSON.stringify(schema)}`,
      maxOutputTokens: 3000,
      temperature: 0.2,
      providerOptions: { gateway: { user: userId || undefined, tags: ["app:nova-ai", `output:${schemaName}`, workspaceId ? `workspace:${workspaceId}` : "workspace:local"] } },
      abortSignal: AbortSignal.timeout(45_000)
    });
    return {
      plan: parseGatewayJson(result.text),
      contribution: { id:generationId, provider: "Vercel AI Gateway", role, model, usage:normalizeUsage(result.usage), createdAt:new Date().toISOString() }
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort: "medium" },
      input: [
        { role: "developer", content: instructions },
        { role: "user", content: JSON.stringify(promptInput) }
      ],
      text: { verbosity: "medium", format: { type: "json_schema", name: schemaName, strict: true, schema } }
    }),
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const result = await response.json();
  const text = result.output_text || result.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text;
  if (!text) throw new Error("OpenAI returned no launch plan");
  return { plan: JSON.parse(text), contribution: { id:response.headers.get("x-request-id") || generationId, provider: "OpenAI", role, model, usage:normalizeUsage(result.usage), createdAt:new Date().toISOString() } };
}

async function generate(input, fallback, schema) {
  const warnings = [];
  let output = null;
  try { output = await runOpenAI(input, schema); } catch (error) { warnings.push(error.message); }
  if (!output) output = { plan: fallback(input), contribution: { provider: "Nova", role: "Founder Agent", model: "Demo engine" } };
  return {
    plan: output.plan,
    evaluation: evaluatePlan(output.plan),
    contributions: [output.contribution],
    warnings
  };
}

async function generateWorkforce(input, fallback, schema) {
  const warnings = [];
  let output = null;
  try {
    output = await runOpenAI(input, schema, {
      role:"Workforce Orchestrator",schemaName:"employee_run",description:"A coordinated set of specialist employee deliverables.",
      instructions:"You are Nova.Ai's workforce orchestrator. Act as five coordinated specialist employees: Strategy, Research, Product, Growth, and Operations. Give each employee a concrete deliverable and an explicit handoff. Use only the provided company context. Distinguish assumptions from evidence. Never claim that external research, customer contact, publishing, spending, deployment, or communication occurred. All external actions must remain proposals requiring founder approval. Return every employee with status completed."
    });
  } catch (error) { warnings.push(error.message); }
  if (!output) output = { plan:fallback(input), contribution:{ provider:"Nova",role:"Workforce Orchestrator",model:"Demo engine" } };
  return { ...output.plan, contribution:output.contribution, warnings };
}

module.exports = { providerStatus, evaluatePlan, generate, generateWorkforce };
