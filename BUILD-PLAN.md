# Build plan

The system is one flow: **User → ElevenLabs Agent → MCP → Data source.** The agent is the
only decision-maker and the only connector between the caller and the data. There is no
separate frontend, repair loop, or backing services beyond these three components.

The one thing that cannot be cut: the agent answering a real question by calling MCP and
getting real data back.

---

## Ownership

| | Role | Owns |
|---|---|---|
| **A** | Data | The data source the MCP server reads from |
| **B** | Voice Agent | ElevenLabs agent — prompt, decision logic for which MCP tool to call and when, voice/accent tuning, `ElevenLabsAgent/sync-agent.ts` |
| **C** | MCP | MCP server, its tools, deploy, wire + verify the agent actually invokes each tool |

---

## Minute zero — before any code

| Who | Action | Why |
|---|---|---|
| B | ElevenLabs → Integrations → **enable custom MCP servers** | Off by default per workspace. Silent failure otherwise: C's tools exist but the agent never calls them |
| A | Confirm data source access | C is blocked without something to query |
| C | Confirm MCP server hosting target (public HTTPS, streamable HTTP) | ElevenLabs does not support stdio — the server must be reachable over HTTPS from minute zero |

---

## A — Data

Provide and document the data source the MCP server's tools query. Confirm shape/access
with C before C starts wiring tool logic against it.

## B — Voice Agent

| Step | Task |
|---|---|
| 1 | Enable MCP in the ElevenLabs workspace |
| 2 | Create the agent. `ElevenLabsAgent/prompt.md`: decision rules for when to call a tool, cite what backs a factual claim, refuse rather than guess when MCP returns nothing |
| 3 | Tune for accented speech — language/auto-detect, turn-taking sensitivity, ASR model. See `ElevenLabsAgent/agent-settings.json` |
| 4 | Attach C's MCP tools once available; verify the agent actually invokes each one |
| 5 | `ElevenLabsAgent/sync-agent.ts` + `.github/workflows/sync-agent.yml` — keeps the live agent's prompt/settings in sync with what's committed |

## C — MCP

| Step | Task |
|---|---|
| 1 | Stand up the MCP server on public HTTPS, streamable HTTP transport |
| 2 | Build tools against A's data source |
| 3 | Register the server in ElevenLabs, attach to the agent |
| 4 | Verify with B that the agent actually invokes each tool — a tool that exists but is never called is a silent failure, not a working feature |

Tools should return in under 1.5s with small payloads — a slow tool stalls the agent
mid-sentence, which in a voice interface reads as a hang.

---

## Dependency graph

```
A: data source ready ──> C: MCP tools can be built

B: MCP workspace opt-in ──> C can attach tools to the agent

C: MCP server live + registered ──> B can attach + verify tool calls
```
