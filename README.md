# UAE Voice Agent

Voice access to UAE government/open data. A caller speaks to an ElevenLabs voice agent,
which is the single decision-maker in the system: it decides what to look up, calls the
right tool on the MCP server, gets the data back, and speaks the answer.

## How it works

```
User (voice — English · العربية)
        │  speaks
        ▼
ElevenLabs Agent  (STT · LLM · TTS)
        │  MCP — streamable HTTP
        ▼
MCP Server
        │  queries
        ▼
Data source
```

The ElevenLabs agent is the bridge and the decision-maker for the whole system:

1. The user speaks a question to the agent.
2. The agent's LLM decides whether it needs data, and if so which MCP tool to call and
   with what arguments.
3. The MCP server runs the tool against the data source and returns the result.
4. The agent turns that result into a spoken answer back to the user.

There is no separate orchestration layer between the agent and MCP, and no intermediate
service the agent's decision passes through — the agent calls the MCP server directly.

See `docs/architecture.svg` for the diagram.

## Support loop

A second, separate flow handles a caller who is unhappy with the service or wants to
report an issue — during the call or at its end. This is deliberately **not** an MCP
tool: it doesn't query the data source, it doesn't need to be fast, and it shouldn't be
confused with the data-lookup path.

```
User (speaks/writes an issue, mid-call or at the end of the call)
        │
        ▼
ElevenLabs Agent  — takes down the issue, calls a webhook tool (outside MCP)
        │
        ▼
Ticket database  — a ticket row is written
        │
        ▼
Linear issue  — created from the ticket, assigned to Devin
        │
        ▼
Devin (Cognition)  — works the ticket
   ├─ resolved → ticket closed
   └─ can't resolve → flagged: engineer needed
```

## Ownership

| | Owns |
|---|---|
| **A** | Data source the MCP server reads from |
| **B** | ElevenLabs agent — prompt, decision logic for which tool to call and when, voice/accent tuning. See `ElevenLabsAgent/` |
| **C** | MCP server — tools, connects to the data source |
| **D** | Support loop — ticket database, the webhook the agent calls to file an issue, Linear → Devin wiring |

## Requirements

- ElevenLabs account with an API token (agent side — B)
- MCP server reachable over public HTTPS, streamable HTTP transport — ElevenLabs does not
  support stdio (C)
- Access to the data source the MCP server reads from (A)
- Ticket database, a webhook endpoint the agent can call to file an issue, and a Linear
  team with the Devin integration installed (D)

## Repo layout

```
ElevenLabsAgent/
  prompt.md               agent system prompt — decision rules, citation/refusal behaviour
  agent-settings.json      language, ASR, turn-taking, voice/accent tuning, MCP tool list
  sync-agent.ts            pushes prompt + settings to the live ElevenLabs agent
```

MCP server (C), data source (A), and the ticket database/webhook/Linear wiring (D) live
in their own paths once pushed — see their respective docs when those land.

## Known limits

[FILL: update once the MCP server and data source are wired up]
