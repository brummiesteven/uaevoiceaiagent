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

## Ownership

| | Owns |
|---|---|
| **A** | Data source the MCP server reads from |
| **B** | ElevenLabs agent — prompt, decision logic for which tool to call and when, voice/accent tuning. See `ElevenLabsAgent/` |
| **C** | MCP server — tools, connects to the data source |

## Requirements

- ElevenLabs account with an API token (agent side — B)
- MCP server reachable over public HTTPS, streamable HTTP transport — ElevenLabs does not
  support stdio (C)
- Access to the data source the MCP server reads from (A)

## Repo layout

```
ElevenLabsAgent/
  prompt.md               agent system prompt — decision rules, citation/refusal behaviour
  agent-settings.json      language, ASR, turn-taking, voice/accent tuning, MCP tool list
  sync-agent.ts            pushes prompt + settings to the live ElevenLabs agent
```

MCP server (C) and data source (A) live in their own paths once pushed — see their
respective docs when those land.

## Known limits

[FILL: update once the MCP server and data source are wired up]
