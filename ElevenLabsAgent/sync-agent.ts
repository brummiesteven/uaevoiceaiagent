#!/usr/bin/env tsx
/**
 * Syncs ElevenLabsAgent/{prompt.md,agent-settings.json} and content/services/*.json
 * to the live ElevenLabs Conversational AI agent.
 *
 * Run manually:   ELEVENLABS_API_KEY=... ELEVENLABS_AGENT_ID=... npx tsx ElevenLabsAgent/sync-agent.ts
 * Run in CI:      .github/workflows/sync-agent.yml, on push to main.
 *
 * Safe to run before A's content or C's MCP tools exist — both steps no-op if their
 * source files/fields are missing, so this can be exercised standalone during the
 * skeleton phase.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const API_BASE = "https://api.elevenlabs.io/v1";
const AGENT_DIR = import.meta.dirname;
const REPO_ROOT = join(AGENT_DIR, "..");

const API_KEY = requireEnv("ELEVENLABS_API_KEY");
const AGENT_ID = requireEnv("ELEVENLABS_AGENT_ID");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

async function elevenlabsFetch(path: string, init: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "xi-api-key": API_KEY,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs API ${init.method ?? "GET"} ${path} failed: ${res.status} ${body}`);
  }
  return res.status === 204 ? null : res.json();
}

type AgentSettings = {
  language: { mode: string; primary: string; additional: string[] };
  asr: { provider: string; quality: string };
  llm: { model: string };
  tts: { model_id: string; voice_id: string };
  turn: { turn_timeout: number; turn_eagerness: string; turn_model: string };
  pronunciation_dictionary: unknown[];
  system_tools: { language_detection: boolean };
  mcp_server_ids: unknown[];
  native_mcp_server_ids: unknown[];
  tool_ids: unknown[];
};

function loadPrompt(): string {
  return readFileSync(join(AGENT_DIR, "prompt.md"), "utf-8");
}

function loadSettings(): AgentSettings {
  const raw = readFileSync(join(AGENT_DIR, "agent-settings.json"), "utf-8");
  return JSON.parse(raw);
}

/**
 * Builds the ElevenLabs agent PATCH payload from our config files.
 * Field names verified against https://elevenlabs.io/docs/api-reference/agents/update
 * as of this writing (asr.provider, turn.turn_timeout/turn_eagerness/turn_model,
 * agent.prompt.tool_ids/native_mcp_server_ids/mcp_server_ids). The API surface moves —
 * re-check before trusting this blindly on a real sync.
 *
 * One field is NOT confirmed: where language_detection goes. Two doc sources
 * disagreed (agent.prompt.built_in_tools vs. an entry inside agent.prompt.tools
 * shaped {type: "system", name: "language_detection"}). This emits the "tools array"
 * shape as the best-supported guess — verify with a GET on the real agent once one
 * exists, and fix here if wrong.
 */
function buildAgentPatch(prompt: string, settings: AgentSettings) {
  const promptConfig: Record<string, unknown> = {
    prompt,
    llm: settings.llm.model,
  };
  // Tool/MCP-server wiring is intentionally a no-op until these ID lists are populated —
  // see agent-settings.json's notes. Each holds resource IDs, not inline definitions.
  if (settings.tool_ids.length > 0) promptConfig.tool_ids = settings.tool_ids;
  if (settings.native_mcp_server_ids.length > 0) promptConfig.native_mcp_server_ids = settings.native_mcp_server_ids;
  if (settings.mcp_server_ids.length > 0) promptConfig.mcp_server_ids = settings.mcp_server_ids;
  if (settings.system_tools.language_detection) {
    promptConfig.tools = [{ type: "system", name: "language_detection" }];
  }

  return {
    conversation_config: {
      agent: {
        prompt: promptConfig,
        language: settings.language.primary,
      },
      asr: {
        provider: settings.asr.provider,
        quality: settings.asr.quality,
      },
      tts: {
        model_id: settings.tts.model_id,
        voice_id: settings.tts.voice_id || undefined,
      },
      turn: {
        turn_timeout: settings.turn.turn_timeout,
        turn_eagerness: settings.turn.turn_eagerness,
        turn_model: settings.turn.turn_model,
      },
    },
  };
}

async function syncAgentConfig() {
  const prompt = loadPrompt();
  const settings = loadSettings();
  const payload = buildAgentPatch(prompt, settings);

  console.log(`Syncing prompt + settings to agent ${AGENT_ID}...`);
  await elevenlabsFetch(`/convai/agents/${AGENT_ID}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  console.log("Agent config synced.");

  if (settings.mcp_server_ids.length === 0 && settings.native_mcp_server_ids.length === 0) {
    console.log("mcp_server_ids / native_mcp_server_ids are empty — skipping MCP wiring (expected until C's server is registered and its ID known).");
  }
  if (settings.tool_ids.length === 0) {
    console.log("tool_ids is empty — skipping support-loop tool wiring (expected until D's file_issue webhook tool is registered and its ID known).");
  }
}

async function syncKnowledgeBase() {
  const servicesDir = join(REPO_ROOT, "content/services");
  if (!existsSync(servicesDir)) {
    console.log("content/services/ does not exist yet — skipping knowledge base sync.");
    return;
  }

  const files = readdirSync(servicesDir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) {
    console.log("content/services/ is empty — skipping knowledge base sync.");
    return;
  }

  for (const file of files) {
    const content = readFileSync(join(servicesDir, file), "utf-8");
    console.log(`Uploading ${file} to knowledge base...`);
    await elevenlabsFetch(`/convai/knowledge-base`, {
      method: "POST",
      body: JSON.stringify({
        name: file.replace(/\.json$/, ""),
        text: content,
      }),
    });
  }
  console.log(`Knowledge base synced (${files.length} document(s)).`);
}

async function main() {
  await syncAgentConfig();
  await syncKnowledgeBase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
