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
  asr: { model: string };
  llm: { model: string };
  tts: { model: string; voice_id: string };
  turn_taking: { interruption_sensitivity: string; silence_end_call_timeout_ms: number };
  pronunciation_dictionary: unknown[];
  mcp_tools: unknown[];
  webhook_tools: unknown[];
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
 * Field names follow the Conversational AI "agent" object shape — verify against
 * current ElevenLabs API docs before first real sync, the API surface moves.
 */
function buildAgentPatch(prompt: string, settings: AgentSettings) {
  const platformSettings: Record<string, unknown> = {};
  // MCP tool wiring is intentionally a no-op until settings.mcp_tools is populated —
  // see ElevenLabsAgent/agent-settings.json's mcp_tools note.
  if (settings.mcp_tools.length > 0) platformSettings.mcp_servers = settings.mcp_tools;
  // Webhook tools (e.g. file_issue — the support-loop tool, separate from MCP) are
  // also intentionally a no-op until D's ticket webhook exists and settings.webhook_tools
  // is populated. Field name/shape is a placeholder — verify against the ElevenLabs
  // API's client tool / webhook tool schema before first real sync.
  if (settings.webhook_tools.length > 0) platformSettings.webhook_tools = settings.webhook_tools;

  return {
    conversation_config: {
      agent: {
        prompt: {
          prompt,
          llm: settings.llm.model,
        },
        language: settings.language.primary,
      },
      asr: {
        model: settings.asr.model,
      },
      tts: {
        model_id: settings.tts.model,
        voice_id: settings.tts.voice_id || undefined,
      },
      turn: {
        interruption_sensitivity: settings.turn_taking.interruption_sensitivity,
      },
    },
    ...(Object.keys(platformSettings).length > 0 ? { platform_settings: platformSettings } : {}),
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

  if (settings.mcp_tools.length === 0) {
    console.log("mcp_tools is empty — skipping MCP tool wiring (expected until C's server is live).");
  }
  if (settings.webhook_tools.length === 0) {
    console.log("webhook_tools is empty — skipping support-loop tool wiring (expected until D's ticket webhook is live).");
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
