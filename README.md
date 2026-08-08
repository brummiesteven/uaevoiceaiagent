# AlHammadi

Voice access to UAE government/open data, for people who find a phone call easier than a
website. A caller speaks to an ElevenLabs voice agent, which is the single decision-maker
in the system: it decides what to look up, calls the right tool on the MCP server, gets
the data back, and speaks the answer.

## The name

Named in honour of **Mohamed Al Hammadi**, the Emirati wheelchair racer who won the UAE's
first Paralympic athletics gold in the 800m T34 at Rio 2016, and who also took medals at
London 2012 and Tokyo.

Many of the people this is built for are People of Determination — someone who is blind
or low-vision, has a motor impairment that makes forms difficult, or simply finds speaking
easier than reading a dense government page. The name is a reminder of who the work is for.

The name is a tribute. Mohamed Al Hammadi has no involvement in this project and has not
endorsed it.

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

MCPServer/               C — the MCP server, its tools and data
  SETUP.md                 start here: nothing to a working voice agent, ~15 min
  README.md                tools, data sources, known landmines
  agent-prompt.md          the prompt this was tested against, and why each rule exists
```

The ticket database/webhook/Linear wiring (D) lives in its own path once pushed — see its
docs when those land. The MCP server reads data.dubai's public API directly, so there is
no separate data-source component to stand up.

## Known limits

[FILL: update once the MCP server and data source are wired up]
