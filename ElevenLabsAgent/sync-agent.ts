#!/usr/bin/env tsx
/**
 * Syncs ElevenLabsAgent/{prompt.md,agent-settings.json} and content/services/*.json
 * to the live ElevenLabs Conversational AI agent.
 *
 * Run manually:   ELEVENLABS_API_KEY=... ELEVENLABS_AGENT_ID=... npx tsx ElevenLabsAgent/sync-agent.ts
 * Run in CI:      .github/workflows/sync-agent.yml, on push to main.
 *
 * Does NOT attach the MCP server — that's MCPServer/scripts/reconnect.js's job (see
 * buildAgentPatch()'s comment). Safe to run before A's content exists or before D's
 * file_issue webhook tool is registered — both no-op if their source files/fields are
 * missing.
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
  first_message: { default: string };
  language: { mode: string; primary: string; additional: string[] };
  asr: { provider: string; quality: string };
  llm: { model: string; temperature: number };
  tts: { model_id: string; voice_id: string };
  turn: { turn_timeout: number; turn_eagerness: string; turn_model: string };
  pronunciation_dictionary: unknown[];
  system_tools: { language_detection: boolean };
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
 * agent.prompt.tool_ids, agent.prompt.temperature). The API surface moves — re-check
 * before trusting this blindly on a real sync.
 *
 * DELIBERATELY does not touch mcp_server_ids / native_mcp_server_ids. C's
 * MCPServer/scripts/reconnect.js is the sole owner of MCP server registration and
 * attachment — its server has no stable URL yet (local + cloudflared tunnel, URL
 * changes every restart), and reconnect.js already handles delete/recreate/reattach
 * correctly. If this script also PATCHed mcp_server_ids, the two would fight over the
 * same field. Do not add MCP wiring here without removing it from reconnect.js first.
 *
 * language_detection placement CORRECTED after tool_ids went from empty to non-empty:
 * the API rejects a PATCH that sets both agent.prompt.tools and agent.prompt.tool_ids
 * together ("Cannot specify both tools and tool IDs"). Sending language_detection as an
 * entry in the `tools` array only worked in earlier testing because tool_ids was still
 * empty then. Confirmed via live PATCH+GET that agent.prompt.built_in_tools.language_detection
 * (an inline object, not the `tools` array) coexists cleanly with tool_ids — use that.
 */
function buildAgentPatch(prompt: string, settings: AgentSettings) {
  const promptConfig: Record<string, unknown> = {
    prompt,
    llm: settings.llm.model,
    temperature: settings.llm.temperature,
  };
  // Webhook tool wiring (file_issue) is intentionally a no-op until tool_ids is
  // populated — see agent-settings.json's note. Holds a resource ID, not an inline
  // tool definition. Unrelated to MCP — see the file-level comment above.
  if (settings.tool_ids.length > 0) promptConfig.tool_ids = settings.tool_ids;
  if (settings.system_tools.language_detection) {
    promptConfig.built_in_tools = { language_detection: { type: "system", name: "language_detection" } };
  }

  return {
    conversation_config: {
      agent: {
        first_message: settings.first_message.default,
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

  if (settings.tool_ids.length === 0) {
    console.log("tool_ids is empty — no webhook tools attached.");
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
    await elevenlabsFetch(`/convai/knowledge-base/text`, {
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
