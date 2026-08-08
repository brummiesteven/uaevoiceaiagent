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
Ticket database  — a ticket row is written, before anything else can fail
        │
        ▼
Linear issue  — created from the ticket, Devin mentioned to start a session
        │
        ▼
Devin (Cognition)  — works the ticket
   ├─ resolved → issue closed → the report closes with it
   └─ can't resolve → labels it `needs-engineer` → Slack pings a human
```

A caller who took the trouble to report something has already spent their patience, so the
row is written first and returned even if Linear is down — an un-ticketed report is still
visible and still recoverable, a dropped one is gone.

The loop is auditable end to end at `/triage`: every report, how it came in, what the
caller said, and the Linear state read live on each load — through to the pull request
that fixed it, without needing an account on our workspace. Slack is reserved for the two
cases where the loop has stalled on a person: Devin was never reached, or Devin escalated.
See `SupportLoop/README.md`.

## Ownership

| | Owns |
|---|---|
| **A** | Data source the MCP server reads from |
| **B** | ElevenLabs agent — prompt, decision logic for which tool to call and when, voice/accent tuning. See `ElevenLabsAgent/` |
| **C** | MCP server — tools, connects to the data source |
| **D** | Support loop — ticket database, the webhook the agent calls to file an issue, Linear → Devin wiring, escalation to Slack, the `/triage` audit trail. See `SupportLoop/` |

## Requirements

- ElevenLabs account with an API token (agent side — B)
- MCP server reachable over public HTTPS, streamable HTTP transport — ElevenLabs does not
  support stdio (C)
- Access to the data source the MCP server reads from (A)
- Supabase project, a Linear team with the Devin integration installed, a Slack incoming
  webhook, and somewhere to deploy the Next.js app (D)

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

SupportLoop/             D — the Next.js app behind the support flow
  README.md                the webhook contract for B, Slack/Linear setup, landmines
  app/api/agent/ticket     the webhook the agent calls to file a report
  app/api/linear-webhook   escalation in, Slack ping out
  app/api/elevenlabs-webhook  post-call transcript, joined onto the report
  app/triage               every report and where it got to, read live from Linear
  app/report               fallback form for anyone not on a call
  supabase/schema.sql      call_feedback and tickets
```

The MCP server reads data.dubai's public API directly, so there is no separate
data-source component to stand up.

## Known limits

[FILL: update once the MCP server and data source are wired up]
