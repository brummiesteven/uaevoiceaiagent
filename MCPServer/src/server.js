import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Catalogue } from './catalogue.js';
import { Indicators } from './indicators.js';
import { LivingInfo } from './living.js';
import { registerTools } from './tools.js';

const PORT = Number(process.env.PORT || 8787);

const catalogue = new Catalogue();
const indicators = new Indicators();
const living = new LivingInfo();
let registry = [];

/**
 * A fresh McpServer per request (stateless mode).
 *
 * ElevenLabs does not reliably carry an MCP session id between calls, and a
 * stateless transport sidesteps the whole question. The expensive state — the
 * hydrated catalogue — lives at module scope and is shared, so this costs
 * almost nothing per request.
 */
function buildServer({ voiceOnly = false } = {}) {
  const server = new McpServer(
    { name: voiceOnly ? 'dubai-open-data-voice' : 'dubai-open-data', version: '1.0.0' },
    {
      instructions:
        'Answers questions about Dubai using the official open data catalogue at data.dubai. ' +
        'For "how many" or "what is the rate of" questions, call get_dubai_indicator first — it ' +
        'returns real published figures. For questions about what data exists, use search_datasets ' +
        'with KEYWORDS rather than the full question. Always attribute figures to their publisher.',
    },
  );
  registry = registerTools(server, { catalogue, indicators, living, voiceOnly });
  return server;
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 4e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!body) return resolve(undefined);
      try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });

async function handleMcp(req, res, voiceOnly) {
  const server = buildServer({ voiceOnly });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close(); server.close(); });
  await server.connect(transport);
  const body = req.method === 'POST' ? await readBody(req) : undefined;
  await transport.handleRequest(req, res, body);
}

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/health') {
    console.error(`[req] ${req.method} ${url.pathname} ua="${(req.headers['user-agent'] || '?').slice(0, 60)}"`);
  }

  // Permissive CORS: the only data served is already public, and a blocked
  // preflight from ElevenLabs is a confusing failure to debug live.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, mcp-protocol-version, authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  if (url.pathname === '/health') {
    const s = catalogue.stats();
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      ok: true,
      datasets: s.totalDatasets,
      entities: s.totalEntities,
      indicators: indicators.list.length,
      accessibilityServices: living.services.length,
      tools: registry.length,
      voiceTools: registry.filter((t) => t.voice).map((t) => t.name),
      catalogueSource: s.source,
      hydratedAt: s.hydratedAt,
    }, null, 2));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/mcp' || url.pathname === '/mcp/voice') {
    try {
      await handleMcp(req, res, url.pathname === '/mcp/voice');
    } catch (err) {
      console.error('[mcp] request failed:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null,
        }));
      }
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
});

const t0 = Date.now();
console.error('[boot] hydrating catalogue from data.dubai …');
await Promise.all([catalogue.hydrate(), indicators.load(), living.load()]);
buildServer(); // populate the registry for /health before the first request
const s = catalogue.stats();
console.error(
  `[boot] ${s.totalDatasets} datasets, ${s.totalEntities} entities, ` +
  `${indicators.list.length} indicators, ${living.services.length} services, ${registry.length} tools ` +
  `(${registry.filter((t) => t.voice).length} voice) — via ${s.source} in ${Date.now() - t0}ms`,
);

httpServer.listen(PORT, () => {
  console.error(`[ready] MCP on http://localhost:${PORT}/mcp  ·  health http://localhost:${PORT}/health`);
});
