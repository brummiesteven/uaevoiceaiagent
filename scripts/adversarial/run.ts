/**
 * Runs the personas against the live agent using ElevenLabs simulation tests and
 * writes one JSON file per persona plus a summary.
 *
 *   npm run test:adversarial
 *   npm run test:adversarial -- language-switch
 *
 * A failing persona is a result, not an error: the point of the suite is to produce
 * the failure the repair loop then fixes. Exit code is non-zero only when a run
 * could not be completed.
 */
import fs from "node:fs";
import path from "node:path";
import { personas } from "./personas";

const API = "https://api.elevenlabs.io/v1";
const RESULTS_DIR = path.join(process.cwd(), "scripts", "adversarial", "results");

type CriterionResult = { result?: string; rationale?: string };

type SimulationResponse = {
  simulated_conversation?: { role: string; message?: string }[];
  analysis?: {
    evaluation_criteria_results?: Record<string, CriterionResult>;
    call_successful?: string;
    transcript_summary?: string;
  };
};

async function simulate(personaIndex: number) {
  const persona = personas[personaIndex];
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  if (!agentId) throw new Error("ELEVENLABS_AGENT_ID is not set");

  const response = await fetch(`${API}/convai/agents/${agentId}/simulate-conversation`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      simulation_specification: {
        simulated_user_config: {
          first_message: persona.firstMessage,
          language: "en",
          prompt: { prompt: persona.prompt },
        },
      },
      extra_evaluation_criteria: persona.criteria.map((criterion) => ({
        id: criterion.id,
        name: criterion.name,
        type: "prompt",
        conversation_goal_prompt: criterion.conversationGoalPrompt,
        use_knowledge_base: false,
      })),
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`simulate-conversation failed for ${persona.id} (${response.status}): ${text}`);
  }
  return JSON.parse(text) as SimulationResponse;
}

function verdict(result: SimulationResponse, criteriaIds: string[]) {
  const results = result.analysis?.evaluation_criteria_results ?? {};
  const rows = criteriaIds.map((id) => ({
    id,
    result: results[id]?.result ?? "unknown",
    rationale: results[id]?.rationale ?? null,
  }));
  const failed = rows.filter((r) => r.result !== "success");
  return { rows, passed: failed.length === 0, failedIds: failed.map((r) => r.id) };
}

async function main() {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const targets = personas.filter((p) => wanted.length === 0 || wanted.includes(p.id));
  if (targets.length === 0) {
    throw new Error(`No matching persona. Known: ${personas.map((p) => p.id).join(", ")}`);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const summary: Record<string, unknown>[] = [];

  for (const persona of targets) {
    process.stdout.write(`Running ${persona.id} — ${persona.targets}\n`);
    const raw = await simulate(personas.indexOf(persona));
    const { rows, passed, failedIds } = verdict(
      raw,
      persona.criteria.map((c) => c.id),
    );

    fs.writeFileSync(
      path.join(RESULTS_DIR, `${persona.id}.json`),
      `${JSON.stringify({ persona: persona.id, targets: persona.targets, criteria: rows, raw }, null, 2)}\n`,
    );
    summary.push({ persona: persona.id, passed, failed: failedIds });
    process.stdout.write(`  ${passed ? "PASS" : `FAIL (${failedIds.join(", ")})`}\n`);
  }

  fs.writeFileSync(
    path.join(RESULTS_DIR, "summary.json"),
    `${JSON.stringify({ ranAt: new Date().toISOString(), results: summary }, null, 2)}\n`,
  );
  const failures = summary.filter((s) => !s.passed).length;
  process.stdout.write(`\n${summary.length - failures}/${summary.length} personas passed\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
