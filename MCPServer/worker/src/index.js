import { z } from 'zod';
import { CatalogueCore } from '../../src/catalogue-core.js';
import { Indicators } from '../../src/indicators-core.js';
import { LivingInfo } from '../../src/living-core.js';
import { buildTools } from '../../src/tools.js';
import { catalogue as catalogueData, indicators as indicatorData, living as livingData } from './data.js';

/**
 * The MCP server as a Cloudflare Worker.
 *
 * Why this exists: tunnelling to a laptop put 2–3 seconds of round trip on
 * every MCP request, and a spoken turn needs several. Measured at the edge
 * instead, the same work costs tens of milliseconds.
 *
 * Why the data is baked in: data.dubai's firewall rejects datacenter IPs — the
 * JSON API as well as the HTML — so a Worker can never fetch the catalogue. It
 * doesn't need to; the catalogue was always a boot-time snapshot, so it ships
 * inside the bundle instead. Nothing here touches the network at all.
 *
 * The MCP SDK isn't used: its transports are built around node's http request
 * and response objects. The protocol surface a client actually needs is small,
 * so it's implemented directly. The *tools* are shared with the Node server via
 * buildTools(), so behaviour can't drift between the two.
 */

// Module scope: built once per isolate, reused across requests.
const catalogue = new CatalogueCore().loadFrom(catalogueData);
const indicators = new Indicators().loadFrom(indicatorData);
const living = new LivingInfo().loadFrom(livingData);
const TOOLS = buildTools({ catalogue, indicators, living });
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** zod shape -> JSON Schema, for tools/list. */
const toJsonSchema = (shape) => {
  if (!shape || Object.keys(shape).length === 0) {
    return { type: 'object', properties: {} };
  }
  const schema = z.toJSONSchema(z.object(shape));
  delete schema.$schema;
  return schema;
};

const SCHEMAS = new Map(TOOLS.map((t) => [t.name, toJsonSchema(t.inputSchema)]));

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version, authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-session-id',
};

/**
 * Answer in whichever framing the client asked for. ElevenLabs sends an Accept
 * listing text/event-stream and the SDK replied with a single SSE frame, so
 * that path is mirrored exactly rather than assumed to be optional.
 */
function rpcResponse(payload, accept) {
  const body = JSON.stringify(payload);
  if ((accept || '').includes('text/event-stream')) {
    return new Response(`event: message\ndata: ${body}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS },
    });
  }
  return new Response(body, { headers: { 'Content-Type': 'application/json', ...CORS } });
}

async function handleRpc(msg, voiceOnly) {
  const { id, method, params } = msg || {};

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: voiceOnly ? 'alhammadi-voice' : 'alhammadi',
          version: '1.0.0',
        },
        instructions:
          'Answers questions about Dubai from official open data. For "how many" or ' +
          '"what is the rate of" questions call get_dubai_indicator first. For what data ' +
          'exists use search_datasets with KEYWORDS, not the full question. Always ' +
          'attribute figures to their publisher.',
      },
    };
  }

  if (method === 'tools/list') {
    const list = TOOLS.filter((t) => !voiceOnly || t.voice).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: SCHEMAS.get(t.name),
    }));
    return { jsonrpc: '2.0', id, result: { tools: list } };
  }

  if (method === 'tools/call') {
    const tool = BY_NAME.get(params?.name);
    if (!tool || (voiceOnly && !tool.voice)) {
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params?.name}` } };
    }
    const result = await tool.handler(params?.arguments || {});
    return { jsonrpc: '2.0', id, result };
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

  // Notifications carry no id and expect no reply.
  if (id === undefined || id === null) return null;
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${method}` } };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === '/health') {
      const s = catalogue.stats();
      return Response.json({
        ok: true,
        runtime: 'cloudflare-worker',
        datasets: s.totalDatasets,
        entities: s.totalEntities,
        indicators: indicators.list.length,
        accessibilityServices: living.services.length,
        tools: TOOLS.length,
        voiceTools: TOOLS.filter((t) => t.voice).map((t) => t.name),
        snapshotFrom: catalogueData.savedAt,
      }, { headers: CORS });
    }

    const isMcp = url.pathname === '/' || url.pathname === '/mcp' || url.pathname === '/mcp/voice';
    if (!isMcp) return Response.json({ error: 'not found' }, { status: 404, headers: CORS });

    if (request.method === 'GET') {
      return new Response('ok', { headers: { 'Content-Type': 'text/plain', ...CORS } });
    }

    let msg;
    try {
      msg = await request.json();
    } catch {
      return Response.json(
        { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
        { status: 400, headers: CORS },
      );
    }

    const voiceOnly = url.pathname === '/mcp/voice';
    try {
      const out = await handleRpc(msg, voiceOnly);
      if (!out) return new Response(null, { status: 202, headers: CORS });
      return rpcResponse(out, request.headers.get('accept'));
    } catch (err) {
      return rpcResponse(
        { jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: String(err?.message || err) } },
        request.headers.get('accept'),
      );
    }
  },
};
