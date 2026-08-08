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
User
  │  opens the site, presses to talk
  ▼
Frontend (Next.js)  — service pages + voice console
  │  live call — real ElevenLabs SDK session, once NEXT_PUBLIC_ELEVENLABS_AGENT_ID is set
  ▼
ElevenLabs Agent  (STT · LLM · TTS)
  │  MCP — streamable HTTP
  ▼
MCP Server
  │  queries
  ▼
Data source
```

**The voice call is simulated until you configure a live agent.** With no
`NEXT_PUBLIC_ELEVENLABS_AGENT_ID` set, the frontend runs a scripted mock transport instead
of a real session — the UI shows a visible "Simulated" banner while it does. This isn't a
bug to hide; it's what lets the frontend run and be reviewed standalone, without every
visitor needing a live ElevenLabs account behind it. See Setup below to make it live.

Once live, the ElevenLabs agent is the bridge and the decision-maker for the whole system:

1. The user speaks a question to the agent.
2. The agent's LLM decides whether it needs data, and if so which MCP tool to call and
   with what arguments.
3. The MCP server runs the tool against the data source and returns the result.
4. The agent turns that result into a spoken answer back to the user — nothing about the
   tool call itself is ever spoken; see `ElevenLabsAgent/prompt.md`'s "Never narrate the
   mechanism" rule.

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

The loop is auditable end to end at `SupportLoop`'s `/triage`: every report, how it came
in, what the caller said, and the Linear state read live on each load — through to the
pull request that fixed it, without needing an account on our workspace. Slack is reserved
for the two cases where the loop has stalled on a person: Devin was never reached, or Devin
escalated. See `SupportLoop/README.md`.

**This is wired to the live agent.** `file_issue` is registered as a webhook tool
(`ElevenLabsAgent/agent-settings.json`'s `tool_ids`), with `conversation_id` bound to
ElevenLabs' `system__conversation_id` dynamic variable rather than left for the LLM to
recall. A caller talking to the live agent can file a ticket mid-call and hear it read
back as a spelled-out reference (e.g. "P E R 2 1") — verified live, ticket visible on
`/triage` within seconds. The post-call transcript webhook (attaches the call transcript
to the ticket) is a separate, still-open step — see `TECH-SPEC.md` §5.

## Ownership

| | Owns |
|---|---|
| **A** | Data source the MCP server reads from |
| **B** | ElevenLabs agent — prompt, decision logic for which tool to call and when, voice/accent tuning. See `ElevenLabsAgent/` |
| **C** | MCP server — tools, connects to the data source. See `MCPServer/` |
| **D** | Frontend (service pages, voice console, persona-test `/triage`) and the support loop (ticket database, webhook, Linear → Devin wiring, Slack escalation, its own `/triage` audit trail). See `SupportLoop/` |

## Setup

This repo holds **three separate Node projects** — the root frontend, `MCPServer/`, and
`SupportLoop/` — each with its own `package.json`, install, and env vars. None of them
depend on each other being installed to run standalone; the frontend just runs in
simulated mode until the other two are live and its env vars point at them.

### 1. Root — the frontend

```bash
git clone <this repo>
cd uaevoiceaiagent
npm install
```

Create `.env.local` in the repo root (there is no `.env.example` committed for it yet —
these are the only env vars the app reads):

| Variable | Required for | If unset |
|---|---|---|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | A real voice call | The voice console runs a scripted mock instead, with a visible "Simulated" banner |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `/triage` showing real adversarial-test rows | `/triage` shows 5 hard-coded example rows and says so on the page |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | The WhatsApp CTA on the homepage | The CTA doesn't render at all |

```bash
npm run dev      # http://localhost:3000
```

`ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` are also needed to run
`npm run sync-agent` (pushes `ElevenLabsAgent/prompt.md` + `agent-settings.json` +
`content/services/*.json` to the live agent) — same two values as
`NEXT_PUBLIC_ELEVENLABS_AGENT_ID` and an ElevenLabs API key from your account's API Keys
page.

### 2. `MCPServer/` — C's MCP server

```bash
cd MCPServer
npm install
cp .env.example .env    # fill ELEVENLABS_API_KEY and AGENT_ID
npm start                # http://localhost:8787
```

Needs a public HTTPS URL for ElevenLabs to reach it — see `MCPServer/SETUP.md` for the
full 15-minute walkthrough (installing `cloudflared`, tunnelling, and registering it
against your agent with `node scripts/reconnect.js <tunnel-url>`).

### 3. `SupportLoop/` — D's ticket pipeline

```bash
cd SupportLoop
npm install
cp .env.example .env.local   # Supabase, Linear, Slack — see the file, every integration degrades gracefully except SUPPORT_AGENT_SECRET
npm run dev
```

Full env var reference and setup order (Supabase schema first, then Linear, then Slack)
in `SupportLoop/README.md`.

### Requirements summary

- ElevenLabs account with an API token (agent side — B)
- MCP server reachable over public HTTPS, streamable HTTP transport — ElevenLabs does not
  support stdio (C)
- Access to the data source the MCP server reads from — data.dubai's public API, no
  credentials needed (A)
- Supabase project, a Linear team with the Devin integration installed, a Slack incoming
  webhook (D)

## Repo layout

```
app/                      D — frontend: service pages, voice console
components/                 voice console UI, WhatsApp CTA, display preferences
lib/                         service-record loading, /triage data, voice call state
content/
  schema.ts                the content contract — service record shape
  services/*.json          hand-written placeholder records (fixture: true) — not a real scrape yet

ElevenLabsAgent/
  prompt.md                agent system prompt — decision rules, citation/refusal behaviour
  agent-settings.json       language, ASR, turn-taking, voice/accent tuning, MCP/tool ids
  sync-agent.ts             pushes prompt + settings + content/services/* to the live agent

MCPServer/                C — the MCP server, its tools and data
  SETUP.md                  start here: nothing to a working voice agent, ~15 min
  README.md                 tools, data sources, known landmines
  agent-prompt.md           the prompt this was tested against, and why each rule exists

SupportLoop/              D — the Next.js app behind the support flow
  README.md                 the webhook contract for B, Slack/Linear setup, landmines
  app/api/agent/ticket      the webhook the agent calls to file a report
  app/api/linear-webhook    escalation in, Slack ping out
  app/api/elevenlabs-webhook  post-call transcript, joined onto the report
  app/triage                every report and where it got to, read live from Linear
  app/report                fallback form for anyone not on a call
  supabase/schema.sql       call_feedback and tickets
```

## Known limits

- The frontend's voice call is simulated by default (see How it works above) — it needs
  `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` set to actually talk to the live agent.
- The support loop's `file_issue` webhook is attached to the live agent and verified
  end to end. The post-call transcript webhook is not yet configured (needs a one-time
  secret from the ElevenLabs dashboard, sent to D) — until then, filed tickets don't get
  the call transcript attached.
- `content/services/*.json` are hand-written placeholders, not a verified scrape — see
  `AGENTS.md` before quoting a value from one as fact.
- Root `/triage` (persona test results) and `SupportLoop`'s `/triage` (ticket audit trail)
  are two different pages with the same name — don't confuse them.
- See `TECH-SPEC.md` §5 for the fuller real-vs-v2 list.
