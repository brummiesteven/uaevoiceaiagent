/**
 * Pushes agent-config/prompt.md and the knowledge base to the live ElevenLabs agent.
 *
 * This is what makes a merged PR change the deployed system rather than just the repo:
 * .github/workflows/sync-agent.yml runs it on every push to main. Without it the repair
 * loop is a ticketing system.
 *
 *   npm run sync:agent            push prompt + knowledge base
 *   npm run sync:agent -- --dry   print what would be pushed
 */
import fs from "node:fs";
import path from "node:path";
import { getServices } from "../content";
import { toKnowledgeBaseDocument } from "../content/schema";

const API = "https://api.elevenlabs.io/v1";
const dryRun = process.argv.includes("--dry");

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
  return key;
}

function agentId(): string {
  const id = process.env.ELEVENLABS_AGENT_ID;
  if (!id) throw new Error("ELEVENLABS_AGENT_ID is not set");
  return id;
}

async function call<T>(pathname: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs ${init.method ?? "GET"} ${pathname} failed (${response.status}): ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

type KnowledgeBaseEntry = {
  type: "text";
  id: string;
  name: string;
  usage_mode: "auto";
};

/**
 * Documents are immutable, so a re-sync uploads a new one and drops the old.
 * Skipping the delete leaves the agent retrieving both the stale and the fixed
 * copy of the same page, which looks exactly like a fix that did not work.
 */
async function deleteStaleDocuments(name: string) {
  const list = await call<{ documents?: { id: string; name: string }[] }>(
    `/convai/knowledge-base?search=${encodeURIComponent(name)}&page_size=100`,
    { method: "GET" },
  );
  for (const doc of list.documents ?? []) {
    if (doc.name !== name) continue;
    await call(`/convai/knowledge-base/${doc.id}?force=true`, { method: "DELETE" });
    process.stdout.write(`  deleted stale ${doc.name} (${doc.id})\n`);
  }
}

async function uploadKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  const entries: KnowledgeBaseEntry[] = [];
  for (const service of getServices()) {
    const doc = toKnowledgeBaseDocument(service);
    if (dryRun) {
      process.stdout.write(`  would upload ${doc.name} (${doc.text.length} chars)\n`);
      continue;
    }
    await deleteStaleDocuments(doc.name);
    const created = await call<{ id: string; name?: string }>("/convai/knowledge-base/text", {
      method: "POST",
      body: JSON.stringify({ name: doc.name, text: doc.text }),
    });
    process.stdout.write(`  uploaded ${doc.name} → ${created.id}\n`);
    entries.push({ type: "text", id: created.id, name: doc.name, usage_mode: "auto" });
  }
  return entries;
}

async function main() {
  const prompt = fs.readFileSync(path.join(process.cwd(), "agent-config", "prompt.md"), "utf8");
  process.stdout.write(`Prompt: ${prompt.length} chars\n`);

  const knowledgeBase = await uploadKnowledgeBase();

  const body = {
    conversation_config: {
      agent: {
        prompt: {
          prompt,
          knowledge_base: knowledgeBase,
          // RAG, not a stuffed prompt: the scraped pages are far longer than the
          // context we want to carry on every turn of a real-time call.
          rag: { enabled: true },
        },
      },
    },
  };

  if (dryRun) {
    process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }

  await call(`/convai/agents/${agentId()}`, { method: "PATCH", body: JSON.stringify(body) });
  process.stdout.write(`Patched agent ${agentId()} with prompt + ${knowledgeBase.length} documents\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
