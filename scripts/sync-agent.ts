#!/usr/bin/env tsx
/**
 * Syncs agent-config/{prompt.md,agent-settings.json} and content/services/*.json
 * to the live ElevenLabs agent.
 *
 * Run manually:   ELEVENLABS_API_KEY=... ELEVENLABS_AGENT_ID=... npx tsx scripts/sync-agent.ts
 * Check payload:  npm run sync-agent -- --dry-run     (no network, no key needed)
 * Run in CI:      .github/workflows/sync-agent.yml, on push to main.
 *
 * This is what makes a merged Devin PR change the running system. If it silently
 * does the wrong thing, the repair loop is theatre — so it fails loudly instead.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.elevenlabs.io/v1";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPT_DIR, "..");
const CONFIG_DIR = join(REPO_ROOT, "agent-config");

const DRY_RUN = process.argv.includes("--dry-run");

type KnowledgeBaseEntry = {
  type: "text";
  name: string;
  id: string;
  usage_mode: "auto";
};

type AgentSettings = {
  language: { mode: string; primary: string; additional: string[] };
  asr: { model: string };
  llm: { model: string };
  tts: { model: string; voice_id: string };
  turn_taking: { interruption_sensitivity: string; silence_end_call_timeout_ms: number };
  pronunciation_dictionary: unknown[];
  mcp_tools: unknown[];
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Refuses to sync while any [FILL: ...] placeholder survives in config.
 *
 * Two of these reach the caller directly: the helpline in the refusal rule would be
 * read aloud verbatim, and the tts.voice_id placeholder is a truthy string that the
 * API rejects. Catching them here costs nothing; catching them mid-demo costs the demo.
 */
function assertNoPlaceholders(files: Record<string, string>) {
  const offenders: string[] = [];
  for (const [label, contents] of Object.entries(files)) {
    contents.split("\n").forEach((line, i) => {
      if (line.includes("[FILL")) offenders.push(`  ${label}:${i + 1}  ${line.trim()}`);
    });
  }
  if (offenders.length > 0) {
    console.error("Refusing to sync — unfilled placeholders remain:\n");
    console.error(offenders.join("\n"));
    console.error("\nFill these in agent-config/ and re-run. The helpline and voice_id");
    console.error("both reach the caller, so a sync with them in place is worse than no sync.");
    process.exit(1);
  }
}

async function elevenlabsFetch(path: string, init: RequestInit, apiKey: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", ...init.headers },
  });
  if (!res.ok) {
    throw new Error(
      `ElevenLabs API ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Uploads each service file as a knowledge base document and returns the entries to
 * attach to the agent.
 *
 * ponytail: previous documents are left in the workspace rather than deleted. The agent
 * only ever sees the list we attach below, so stale copies cannot be retrieved — they
 * are just clutter. Cleanup by name is v2, once there are enough syncs for it to matter.
 */
async function uploadKnowledgeBase(apiKey: string): Promise<KnowledgeBaseEntry[]> {
  const servicesDir = join(REPO_ROOT, "content/services");
  if (!existsSync(servicesDir)) {
    console.log("content/services/ does not exist yet — skipping knowledge base sync.");
    return [];
  }

  const files = readdirSync(servicesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("content/services/ is empty — skipping knowledge base sync.");
    return [];
  }

  const entries: KnowledgeBaseEntry[] = [];
  for (const file of files) {
    const name = file.replace(/\.json$/, "");
    const text = readFileSync(join(servicesDir, file), "utf-8");

    if (DRY_RUN) {
      console.log(`[dry-run] would upload ${file} (${text.length} chars) as "${name}"`);
      entries.push({ type: "text", name, id: `dry-run-${name}`, usage_mode: "auto" });
      continue;
    }

    console.log(`Uploading ${file} to knowledge base...`);
    const doc = await elevenlabsFetch(
      "/convai/knowledge-base/text",
      { method: "POST", body: JSON.stringify({ name, text }) },
      apiKey,
    );
    entries.push({ type: "text", name, id: doc.id, usage_mode: "auto" });
  }

  console.log(`Knowledge base: ${entries.length} document(s) ready to attach.`);
  return entries;
}

function buildAgentPatch(
  prompt: string,
  settings: AgentSettings,
  knowledgeBase: KnowledgeBaseEntry[],
) {
  return {
    conversation_config: {
      agent: {
        prompt: {
          prompt,
          llm: settings.llm.model,
          // Only sent when we actually uploaded documents. Sending an empty array would
          // detach whatever is currently attached in the dashboard.
          ...(knowledgeBase.length > 0 ? { knowledge_base: knowledgeBase } : {}),
        },
        language: settings.language.primary,
      },
      asr: { model: settings.asr.model },
      tts: { model_id: settings.tts.model, voice_id: settings.tts.voice_id },
      turn: { interruption_sensitivity: settings.turn_taking.interruption_sensitivity },
    },
    ...(settings.mcp_tools.length > 0
      ? { platform_settings: { mcp_servers: settings.mcp_tools } }
      : {}),
  };
}

async function main() {
  const prompt = readFileSync(join(CONFIG_DIR, "prompt.md"), "utf-8");
  const settingsRaw = readFileSync(join(CONFIG_DIR, "agent-settings.json"), "utf-8");

  assertNoPlaceholders({ "agent-config/prompt.md": prompt, "agent-config/agent-settings.json": settingsRaw });

  const settings: AgentSettings = JSON.parse(settingsRaw);
  const apiKey = DRY_RUN ? "" : requireEnv("ELEVENLABS_API_KEY");
  const agentId = DRY_RUN ? "<agent-id>" : requireEnv("ELEVENLABS_AGENT_ID");

  const knowledgeBase = await uploadKnowledgeBase(apiKey);
  const payload = buildAgentPatch(prompt, settings, knowledgeBase);

  if (DRY_RUN) {
    console.log("\n[dry-run] PATCH /convai/agents/<agent-id>\n");
    console.log(JSON.stringify(payload, null, 2));
    console.log("\n[dry-run] No requests sent. Config is well-formed.");
    return;
  }

  console.log(`Syncing prompt + settings to agent ${agentId}...`);
  await elevenlabsFetch(
    `/convai/agents/${agentId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    apiKey,
  );
  console.log("Agent config synced.");

  if (settings.mcp_tools.length === 0) {
    console.log("mcp_tools is empty — skipping MCP tool wiring (expected until C's server is live).");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
