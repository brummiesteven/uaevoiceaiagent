# TECH-SPEC

## 01. The problem

UAE government/open data is public but not accessible in the form most people can use.
A person who wants an answer to a plain-language question has to find the right page,
find the right dataset, and read it. That's a real barrier for anyone who finds speaking
easier than reading a dense page, can't easily fill in a form, or is blind or low-vision —
who this is built for, see "The name" in `README.md`.

**What we built:** a lightweight website hosts a voice console; a caller presses to talk
and asks a question in plain language. An ElevenLabs agent decides what data it needs,
calls the right tool on an MCP server, and speaks the answer back — no menu to navigate,
no form to fill in, once the call starts. The website is a thin shell around that call, not
the product itself.

**Why voice specifically:** reading a government page assumes you can see it, parse
administrative language, and know which of several similar-sounding services applies to
you. Speaking a question in your own words sidesteps all three — you don't need to find
the right page if you can just ask.

---

## 02. Architecture

The system has three lanes, and which lane a component sits in is a design decision, not an
accident of layout. Context.dev runs **before** any call and never during one. Devin runs
**after** a call has already gone wrong. Only the middle lane has a latency budget.

```
CAPTURE TIME — runs before any call, never inside one
─────────────────────────────────────────────────────────────────────────────────
  data.dubai rendered pages      DEWA tariffs       RTA · Parkin entitlements
  (headline statistics; the           │                      │
   F5 WAF blocks the API route)       │                      │
              └───────────────┬───────┴──────────────────────┘
                              │  Context.dev — structured extraction
                              │  (web-scrape-markdown / web-extract, UAE-routed)
                              ▼
              MCPServer/data/indicators.json · living-in-dubai.json
                              │  committed to the repo, loaded once at boot
                              ▼
══════════════════════ in-memory catalogue ══════════════════════════════════════
                              ▲
CALL TIME — nothing in this lane touches the network                │ single-digit ms
─────────────────────────────────────────────────────────────────────────────────
  Caller ──speaks──▶ Frontend ──▶ ElevenLabs Agent ──MCP/HTTP──▶ MCP Server
  (EN · العربية)     voice console   STT · LLM · TTS                  │ boot only
                                          │                           ▼
                                          │                  data.dubai /o/c
                                          │                  public REST, cached
                                          │
                    caller is unhappy ────┘
                    file_issue — a webhook tool, deliberately NOT MCP
                                          │
REPAIR LOOP — no latency budget, deliberately separate
─────────────────────────────────────────┼───────────────────────────────────────
                                          ▼
                            SupportLoop · /api/agent/ticket
                                          │  row written FIRST, before
                                          │  anything else can fail
                                          ▼
                                 Supabase · call_feedback
                                          │
                                          ▼
                                   Linear issue created
                                          │  @devin mentioned in a comment
                                          │  (assignment silently no-ops — §06)
                                          ▼
                            ╔═════════════════════════════╗
                            ║   Devin  (Cognition)        ║  first responder
                            ║   autonomous engineer       ║  on every ticket
                            ╚═════════════════════════════╝
                                          │
                    ┌─────────────────────┴──────────────────────┐
                    ▼                                            ▼
             fixes it                                    can't fix it
             opens a PR                                  labels needs-engineer
             issue closes                                         │
                    │                                             ▼
                    │                            Linear webhook (HMAC-SHA256)
                    │                                             │
                    │                                             ▼
                    │                                  Slack — a named human
                    │                                  is now on the hook
                    └──────────────────┬──────────────────────────┘
                                       ▼
                        /triage — every report, live Linear state,
                        through to the PR that fixed it
```

The lane boundaries are the load-bearing part. Context.dev's output is committed JSON, so a
call never waits on a scrape — the answer path holds its latency budget precisely *because*
the capture lane is not in it (§03). Devin sits entirely outside the call: by the time it
runs the caller has hung up, so it has no latency budget to blow either. Slack is touched
only in the single branch where the loop has stalled on a person.

Narrowed to the answer path alone, that middle lane is:

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

**The frontend is a thin shell, and is honest when it's simulating.** With no
`NEXT_PUBLIC_ELEVENLABS_AGENT_ID` configured, `lib/voice/useVoiceCall.ts` runs a scripted
mock transport (`lib/voice/mockTransport.ts` + `mockAnswers.ts`) instead of a real
ElevenLabs session, and the UI shows a visible "Simulated" banner while it does — this lets
the frontend be reviewed and demoed without every environment needing a live agent behind
it. Once the env var is set, `useConversation` from `@elevenlabs/react` opens a real
WebRTC session against the live agent.

Once live, the ElevenLabs agent is the only decision-maker and the only connector between
the caller and the data:

1. The user speaks a question.
2. The agent's LLM decides whether it needs data to answer, and if so, which MCP tool to
   call and with what arguments.
3. The MCP server executes the tool against the data source and returns a result.
4. The agent turns that result into a spoken answer and delivers it to the user — nothing
   about the tool call itself is ever spoken to the caller (see `ElevenLabsAgent/prompt.md`'s
   "Never narrate the mechanism" rule, added after a live test showed the agent reading
   `[Calling tool ...]` syntax and raw JSON out loud).

There is deliberately no orchestration layer between the agent and the MCP server, and no
intermediate service sitting between the agent's decision and the tool call — the agent
talks to MCP directly. Inserting an extra hop there adds a round-trip inside a real-time
voice loop, and conversation quality degrades badly past ~800ms of dead air.

### Roles

| Component | Owner | Responsibility |
|---|---|---|
| Frontend | D | Service pages, voice console, persona-test `/triage`. See `app/`, `components/`, `lib/` |
| ElevenLabs Agent | B | Prompt, decision logic (which tool to call and when), voice/accent tuning, citation and refusal behaviour |
| MCP Server | C | Exposes tools, queries the data source, returns results the agent can turn into speech |
| Data source | A | The underlying data the MCP server's tools read from |
| Support loop | D | Ticket database, the webhook the agent calls to file an issue, Linear → Devin wiring, Slack escalation, its own `/triage` audit trail. See `SupportLoop/` |

### Content contract (frontend + agent knowledge base)

`content/schema.ts` is a separate contract from the MCP tools above — it feeds the
frontend's static service pages (`app/services/[slug]/page.tsx`) and, via
`ElevenLabsAgent/sync-agent.ts`, prose into the agent's knowledge base (RAG). Every record
under `content/services/*.json` currently has `fixture: true` — they're hand-written
placeholders written to unblock the frontend build, not a real scrape. It has no
relationship to `MCPServer/`'s tools, which are independently coded against data.dubai and
Context.dev-captured snapshots (see §03).

### Tool contract

MCP tools return small, fast payloads — under 1.5s. A slow or verbose tool stalls the
agent mid-sentence, which in a voice interface reads as a hang. Exact tool names/schemas
are owned by C; the agent's prompt (owned by B) is what decides when each one gets called.

### Grounding and refusal

Every factual claim the agent makes should trace back to a tool result — the agent does
not answer from general knowledge. If the MCP server has no data for a question, the
agent says so plainly and does not guess. See `ElevenLabsAgent/prompt.md` for the exact
rules.

### Support loop — a second, separate flow

If a caller is unhappy with the service, or wants to report an issue, that is handled by
a second flow, deliberately kept apart from the data-query flow above:

```
User (speaks/writes an issue — mid-call or at the end of the call)
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
   └─ can't resolve → labels it `needs-engineer`
                          │
                          ▼
                   Linear webhook → Slack — a named human is now on the hook
```

This is **not** an MCP tool call. MCP tools exist to answer the caller's question from
the data source under a 1.5s budget; filing an issue is neither a data lookup nor
latency-sensitive in the same way, and conflating the two paths would make it unclear
which failures belong to "the agent couldn't find data" versus "the agent itself failed
the caller." The agent reaches the ticket-filing webhook directly, the same way it
reaches MCP directly — no orchestration layer here either.

**Deployed and verified in production**, at `https://uae-voice-support-loop.vercel.app`
(Vercel project root is `SupportLoop/`, so it deploys independently of the frontend):

| Endpoint | State |
|---|---|
| `POST /api/agent/ticket` — the agent files a report | Live. Rejects unauthenticated calls with 401, accepts authenticated ones with 200, verified against production, not a mock |
| `POST /api/linear-webhook` — escalation in, Slack out | Live. Registered on the Linear team for Issue events; Linear's own deliveries return 200 and forged signatures are rejected with `401 Signature mismatch` |
| `/triage` — the audit trail | Live, readable without a Linear account |
| `POST /api/elevenlabs-webhook` — post-call transcript | Live. HMAC over `` `${timestamp}.${rawBody}` `` verified against the ElevenLabs signing secret; a correctly signed delivery returns 200 and attaches its turns, a forged one `401 Signature mismatch`, and timestamps older than 30 minutes are refused |

Every stage from "report filed" through "Slack pings a human" runs against real Linear and
real Slack. Applying `needs-engineer` to a live issue put a message in the channel.

The transcript route refuses to serve at all without its secret — it returns 500 rather
than accepting an unverified payload, because an unauthenticated endpoint that writes
transcripts into the database is worse than one that is switched off. ElevenLabs generates
that secret when the workspace-level `post_call_transcription` webhook is created, so it
could only come from B's side; it is now set in production and the route verifies.

**One gap remains:** `ElevenLabsAgent/agent-settings.json`'s `tool_ids` is still empty, so
a caller on a live call has no route to the ticket endpoint. The ways in today are the
`/report` form and a direct POST — Devin has picked up and replied to a real ticket filed
that way. See §05.

The flag is the `needs-engineer` label in Linear, and that is the whole escalation
contract: no extra service, no polling job, no state of our own to keep in sync, and a
human can raise it by hand for the same effect. A Linear webhook turns the label into a
Slack message the moment it lands, which is what stops the flag from depending on someone
happening to open `/triage`. Nothing else pings Slack — a channel that fires on every
caller report gets muted, and a muted channel loses the escalations too.

The order matters: the report row is written before Linear is called, and returned even if
Linear fails. Losing a report to an integration outage is the one failure this loop exists
to prevent.

---

## 03. Tool rationale — why ElevenLabs / Context.dev / Devin, specifically

### ElevenLabs — the agent layer

The agent is the orchestrator for the entire call — STT, LLM turn, TTS, turn-taking, and
interruption handling all happen inside it. We deliberately did not build a custom
orchestration layer between the MCP server and the agent, for the latency reason in §02.

Remove the agent and there is no call and no way for the user to reach the data at all —
it is the only interface to the system.

*Model choice within ElevenLabs matters too:* `gemini-2.0-flash` was tried first as the
agent's LLM and did not reliably call tools — when it skipped a tool call it filled the gap
with an invented population figure rather than admitting it didn't know. `claude-sonnet-5`
called tools reliably in the same test and is what's configured in
`ElevenLabsAgent/agent-settings.json`.

### Context.dev — capturing what isn't in a live API

`MCPServer/data/indicators.json` (headline statistics — population, inflation, GDP growth)
and `MCPServer/data/living-in-dubai.json` (DEWA utility tariffs, People of Determination
entitlements from RTA and Parkin) are both captured with Context.dev, per
`MCPServer/README.md`. This data is real but genuinely unreachable any other way in this
build's timeframe: it's published only on rendered data.dubai pages, DEWA's site, and
RTA/Parkin's sites — not exposed through any API. Context.dev did the structured
extraction from those rendered pages so the MCP server could serve it from memory instead
of scraping live on every call.

Two specifics recorded in the data files' own `captureMethod` fields, because they explain
why the route was necessary rather than convenient:

- `indicators.json` — *"context.dev web-scrape-markdown with country=ae (the F5 WAF on
  data.dubai rejects other routes)"*. The site's WAF blocks direct programmatic access to
  the pages carrying these figures; a plain `fetch` returns nothing usable.
- `living-in-dubai.json` — *"context.dev (web-scrape-markdown / web-extract), routed
  through a UAE IP"*. Geo-restricted content that a build machine outside the UAE cannot
  reach at all.

**The capture lane is not in the call path** (see the diagram in §02). Its output is
committed JSON that the MCP server loads once at boot and holds in memory, which is what
lets tool calls return in single-digit milliseconds. Context.dev is therefore a build-time
dependency, not a runtime one — if it were unavailable tomorrow, every call would still
work; only refreshing the figures would be blocked.

This is separate from `content/services/*.json` (§02) — those are hand-written frontend
fixtures, not Context.dev output. Only `MCPServer/`'s data was actually captured this way.

*Alternative rejected:* hand-writing the same figures, the way `content/services/*.json`
currently is. Faster to start, but with no source-of-truth link back to the page it came
from, and no repeatable refresh path if a tariff or entitlement changes.

### Devin — first responder on every ticket

Devin is genuinely wired into the deployed system, not just available in principle: it's
mentioned via `@devin` on every Linear issue the support loop creates
(`SupportLoop/lib/linear.ts`), and has picked up and replied to a real ticket filed through
the live production endpoint. The escalation half is wired too — a Linear webhook is
registered against the team, its HMAC-SHA256 signature is verified on every delivery, and
applying `needs-engineer` to a real issue put a real message in Slack. So both of Devin's
outcomes are closed loops in production, not just the happy one.

Why an autonomous coding agent rather than routing straight to a human
on-call: most tickets are the same two shapes (§AGENTS.md — a behavioural prompt fix or a
stale content fact), narrow enough for Devin to fix correctly without needing a person to
context-switch first. The `needs-engineer` escalation exists specifically for the tickets
that aren't that shape, so this isn't a bet that Devin can close everything — it's a filter
that keeps a human from being paged for a one-line prompt fix.

*A real integration bug surfaced while wiring this, worth recording as evidence Devin is
actually integrated and not just planned:* Linear's `issueCreate` API accepts an
`assigneeId` for the Devin app user and returns success, but silently does not assign the
issue. The `@devin` mention in a comment is what actually starts a session — the code
verifies this by reading the result back rather than trusting the mutation. See
`TECH-SPEC.md` §06.

---

## 04. Feasibility — scoping to 6 hours

Four people, four independently-buildable pieces, one dependency that had to land first:

- **A — data source.** Turned out to have no build cost: data.dubai's catalogue API is
  live and public, no credentials needed. This freed A's time rather than costing it.
- **B — the ElevenLabs agent.** Scoped to config-as-code (`ElevenLabsAgent/`) rather than
  a custom application: a system prompt, a settings file, and a sync script that PATCHes
  the real ElevenLabs API. No orchestration layer, no custom STT/TTS pipeline — deliberately
  ruled out up front (§02) because building one would have both cost hours and made the
  call slower.
- **C — the MCP server.** The one true dependency: nothing else can be verified against
  real tool calls until an MCP server exists. Scoped to two endpoints off one codebase
  (`/mcp/voice` — 10 tools for the agent, `/mcp` — all 20, for any other MCP client) rather
  than building two servers, and to an in-memory catalogue (hydrated once at boot) rather
  than a database, which is why tool calls return in single-digit milliseconds internally.
- **D — frontend + support loop.** Split into two independently-shippable halves: a
  frontend that works even with nothing else running (mock transport, §02) so it never
  blocked on B or C being live, and a support loop that's a genuinely separate Next.js app
  (`SupportLoop/`) rather than routes bolted onto the frontend — so a bug in one couldn't
  take down the other, and each could be tested against its own real API (Linear, Supabase,
  Slack) independently.

**What got cut to fit the window, deliberately, not by accident:**
- A real content-scrape pipeline for `content/services/*.json` — hand-written fixtures
  stand in for it (§02, §05).
- Wiring the support-loop webhook onto the live agent's `tool_ids` — the webhook was
  deployed and verified end to end against production instead, which proves every stage
  except the ElevenLabs-side tool registration.
- A single unified app — three separate Node projects, each independently deployable and
  testable, cost more setup overhead than one monolith would have, but meant no team member
  was blocked waiting on another's code to build cleanly (see `0e3efb2`'s TypeScript-project
  exclusion fix, needed only because they're separate projects sharing a repo).

---

## 05. Extensibility — what v2 looks like

- **Wire the support loop onto the live agent.** Register `file_issue` as a webhook tool
  against `https://uae-voice-support-loop.vercel.app/api/agent/ticket` and populate
  `ElevenLabsAgent/agent-settings.json`'s `tool_ids` — the single largest gap between
  "deployed" and "reachable by a caller," since everything behind the endpoint already
  runs in production.
- **Send `conversation_id` on every `file_issue` call.** The transcript and the report
  arrive out of order by design — the caller complains mid-call, ElevenLabs finishes
  processing minutes later — and `conversation_id` is the only join key between them. Both
  halves are live; without the id they simply never meet.
- **Make the live voice call the default**, not opt-in. Requires a stable, non-tunnel
  deployment of `MCPServer/` (today it's local + `cloudflared`, which changes URL on every
  restart) and documenting/provisioning `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` for real
  deployments.
- **Replace `content/services/*.json`'s hand-written fixtures with a real Context.dev
  scrape**, the same pattern already proven for `MCPServer/`'s data (§03) — `fixture: true`
  is the flag that marks exactly which records still need this.
- **Replace root `/triage`'s hard-coded example rows with live Supabase data** — the
  fallback already exists and is honest about being a fallback; wiring
  `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` for that specific table is what's
  left.
- **Reconcile the two servers' conflicting data.** `MCPServer/` and the frontend's
  `content/services/determination-parking-permit.json` fixture describe the same parking
  permit with different issuer, fee, and helpline — worth resolving before either is
  treated as authoritative in a demo.
- **Notify the caller when their ticket closes.** Today nothing writes back to the person
  who reported an issue — `/triage` and Linear both know the state, the caller doesn't.
- **Continuous adversarial regression** — run the persona test suite behind root `/triage`
  against every merged Devin PR automatically, rather than as a manual check.

---

## 06. Honest risks

- **Wrong or unsupported answers are a real harm,** not a demo bug — the agent should
  cite what backs a claim and refuse rather than guess when the MCP server returns
  nothing.
- **Data can go stale.** `MCPServer/`'s Context.dev-captured figures (§03) are a
  point-in-time snapshot with no automatic refresh; `content/services/*.json`'s fixtures
  are explicitly unverified placeholders until the real scrape (§05) replaces them.
- **A ticket that Devin can't resolve and that never reaches an engineer is worse than no
  loop at all** — it looks handled but isn't. Closed by pushing the `needs-engineer` label
  to Slack rather than waiting for someone to open `/triage`. That path is now live and
  proven — a real `needs-engineer` label produced a real Slack message. The residual risk
  is the Slack webhook failing silently; `/triage` still lists escalations first as the
  backstop, and a missing `SLACK_WEBHOOK_URL` is called out on the page.
- **A signing secret is only as good as its secrecy.** `LINEAR_WEBHOOK_SECRET` gates the
  one path that can put a message in the team's Slack, so the placeholder used in local
  development was deliberately not promoted — production runs a freshly generated secret,
  set on both the Linear webhook and Vercel. A publicly known signing secret would let
  anyone forge an escalation.
- **Linear will not assign an issue to the Devin app user** — it accepts `assigneeId`,
  returns success, and leaves the issue with whoever owns the API key. Mentioning `@devin`
  in a comment is what actually starts a session, so the handoff is verified by reading the
  result back rather than trusting the mutation. Left unchecked this is the failure mode
  where the whole loop looks green and reaches nobody.
- **Not an official service.** No affiliation with any UAE government entity or with
  Mohamed Al Hammadi (see `README.md`).
