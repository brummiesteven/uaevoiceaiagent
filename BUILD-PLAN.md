# Build plan

The system is two flows sharing one agent:

1. **Data-query flow:** User → ElevenLabs Agent → MCP → Data source. The agent is the
   decision-maker and the only connector between the caller and the data.
2. **Support loop:** User (mid-call or at the end of a call) → ElevenLabs Agent → a
   webhook tool, outside MCP → ticket database → Linear issue → Devin, which resolves
   the ticket or flags that an engineer is needed.

There is no separate frontend or other backing service beyond these.

The one thing that cannot be cut: the agent answering a real question by calling MCP and
getting real data back.

---

## Ownership

| | Role | Owns |
|---|---|---|
| **A** | Data | The data source the MCP server reads from |
| **B** | Voice Agent | ElevenLabs agent — prompt, decision logic for which MCP tool to call and when, voice/accent tuning, `ElevenLabsAgent/sync-agent.ts` |
| **C** | MCP | MCP server, its tools, deploy, wire + verify the agent actually invokes each tool |
| **D** | Support loop | Ticket database, the webhook the agent calls to file an issue, Linear team + Devin integration, engineer-escalation flag |

---

## Minute zero — before any code

| Who | Action | Why |
|---|---|---|
| B | ElevenLabs → Integrations → **enable custom MCP servers** | Off by default per workspace. Silent failure otherwise: C's tools exist but the agent never calls them |
| A | Confirm data source access | C is blocked without something to query |
| C | Confirm MCP server hosting target (public HTTPS, streamable HTTP) | ElevenLabs does not support stdio — the server must be reachable over HTTPS from minute zero |
| D | Stand up the ticket database, confirm Linear team + Devin integration installed | B needs a real webhook endpoint before the agent's complaint-handling can be wired and tested |

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

## D — Support loop

| Step | Task |
|---|---|
| 1 | Stand up the ticket database and a webhook endpoint the agent can call to file an issue |
| 2 | Wire ticket creation → Linear issue, assigned to Devin |
| 3 | Confirm Devin resolves what it can and flags tickets it can't as needing an engineer |
| 4 | Give B the webhook endpoint + payload shape so the agent's prompt and tool config can be finalised |

This is deliberately not an MCP tool — it doesn't query A's data source and isn't
latency-sensitive the same way a data lookup is. Keep it a separate path so a caller
complaint is never confused with "the data source had nothing."

---

## Dependency graph

```
A: data source ready ──> C: MCP tools can be built

B: MCP workspace opt-in ──> C can attach tools to the agent

C: MCP server live + registered ──> B can attach + verify tool calls

D: ticket webhook live ──> B can wire + verify the agent's complaint-filing tool
```
