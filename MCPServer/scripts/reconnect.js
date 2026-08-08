#!/usr/bin/env node
/**
 * Re-point the ElevenLabs agent at a new tunnel URL.
 *
 * cloudflared quick tunnels get a fresh random hostname on every restart, and
 * ElevenLabs treats an MCP server's URL as immutable — so the integration has
 * to be deleted and recreated, then re-attached to the agent. Doing that by
 * hand mid-demo is exactly when it goes wrong.
 *
 *   node scripts/reconnect.js https://new-name.trycloudflare.com
 *
 * Reads ELEVENLABS_API_KEY and AGENT_ID from the environment or .env
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:https';

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env is optional */ }
  return env;
}

const env = loadEnv();
const API_KEY = env.ELEVENLABS_API_KEY;
const AGENT_ID = env.AGENT_ID;
const base = (process.argv[2] || '').replace(/\/+$/, '');

if (!API_KEY || !AGENT_ID) {
  console.error('Missing ELEVENLABS_API_KEY or AGENT_ID (set them in .env)');
  process.exit(1);
}
if (!/^https:\/\//.test(base)) {
  console.error('Usage: node scripts/reconnect.js https://<your-tunnel>.trycloudflare.com');
  process.exit(1);
}

const api = (method, path, body) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = request(
      `https://api.elevenlabs.io${path}`,
      {
        method,
        headers: {
          'xi-api-key': API_KEY,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          if (res.statusCode >= 400) return reject(new Error(`${method} ${path} → ${res.statusCode}: ${b.slice(0, 200)}`));
          try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

const voiceUrl = `${base}/mcp/voice`;
console.log(`Re-pointing agent ${AGENT_ID} at ${voiceUrl}\n`);

// 1. Verify the new URL is actually serving MCP before touching the agent —
//    far better to fail here than to leave the agent pointed at nothing.
const probe = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
if (!probe?.ok) {
  console.error(`✗ ${base}/health did not respond. Is the server running and the tunnel up?`);
  process.exit(1);
}
console.log(`✓ server healthy — ${probe.datasets} datasets, ${probe.tools} tools`);

// 2. Detach from the agent BEFORE deleting — ElevenLabs returns 409 if you try
//    to delete an MCP server that is still referenced by an agent.
await api('PATCH', `/v1/convai/agents/${AGENT_ID}`, {
  conversation_config: { agent: { prompt: { mcp_server_ids: [] } } },
});
console.log('✓ detached old integration from agent');

// 3. Remove stale integrations pointing at dead tunnels.
const { mcp_servers: existing = [] } = await api('GET', '/v1/convai/mcp-servers');
for (const s of existing) {
  if (s.config?.name === 'Dubai Open Data') {
    await api('DELETE', `/v1/convai/mcp-servers/${s.id}`).then(
      () => console.log(`✓ removed stale integration ${s.id}`),
      (e) => console.log(`  (could not remove ${s.id}: ${e.message.slice(0, 80)})`),
    );
  }
}

// 4. Recreate and re-attach.
const created = await api('POST', '/v1/convai/mcp-servers', {
  config: {
    url: voiceUrl,
    name: 'Dubai Open Data',
    description: 'Official Dubai open data catalogue and headline statistics',
    transport: 'STREAMABLE_HTTP',
    approval_policy: 'auto_approve_all',
  },
});
console.log(`✓ created integration ${created.id}`);

await api('PATCH', `/v1/convai/agents/${AGENT_ID}`, {
  conversation_config: { agent: { prompt: { mcp_server_ids: [created.id] } } },
});
console.log('✓ agent re-attached');

const tools = await api('GET', `/v1/convai/mcp-servers/${created.id}/tools`);
console.log(`✓ ElevenLabs can see ${tools.tools?.length ?? 0} tools\n`);
console.log('Ready. Talk to the agent at:');
console.log(`  https://elevenlabs.io/app/talk-to?agent_id=${AGENT_ID}`);
