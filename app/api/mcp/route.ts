import { NextRequest, NextResponse } from "next/server";
import { tools } from "@/lib/mcp/tools";

export const runtime = "nodejs";

/**
 * MCP server, HTTP streamable transport, single JSON response per request.
 * Register the deployed URL under ElevenLabs → Agents → Integrations → Custom MCP
 * server (custom MCP servers are disabled per workspace by default).
 *
 * Written directly against the JSON-RPC wire format rather than the MCP SDK: the
 * only transport this needs is one POST, and the SDK's session handling assumes a
 * long-lived server process, not a serverless route.
 */

const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

const result = (id: JsonRpcRequest["id"], value: unknown) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  result: value,
});

const failure = (id: JsonRpcRequest["id"], code: number, message: string) => ({
  jsonrpc: "2.0" as const,
  id: id ?? null,
  error: { code, message },
});

function handle(request: JsonRpcRequest) {
  switch (request.method) {
    case "initialize":
      return result(request.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "uae-services-mcp", version: "0.1.0" },
      });

    case "ping":
      return result(request.id, {});

    case "tools/list":
      return result(request.id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });

    case "tools/call": {
      const name = String(request.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return failure(request.id, -32602, `Unknown tool: ${name}`);
      const args = (request.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const payload = tool.handler(args);
        return result(request.id, {
          content: [{ type: "text", text: JSON.stringify(payload) }],
          isError: false,
        });
      } catch (error) {
        return result(request.id, {
          content: [
            {
              type: "text",
              text: `Tool ${name} failed: ${error instanceof Error ? error.message : "unknown error"}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return failure(request.id, -32601, `Method not found: ${request.method}`);
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failure(null, -32700, "Parse error"), { status: 400 });
  }

  const batch = Array.isArray(body) ? body : [body];
  const responses = batch
    .filter((entry): entry is JsonRpcRequest => Boolean(entry) && typeof entry === "object")
    // Notifications (no id) get no response body, per JSON-RPC.
    .filter((entry) => entry.id !== undefined && entry.id !== null)
    .map(handle);

  if (responses.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0]);
}

/** No server-initiated stream: everything this server does fits in a POST response. */
export function GET() {
  return NextResponse.json(
    { error: "This MCP server only supports POST (HTTP streamable, no SSE channel)." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
