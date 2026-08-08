# Support loop (D)

The path from "the agent failed this caller" to "a person fixed it", and the proof it
happened. This is the second flow in TECH-SPEC — deliberately not an MCP tool, because
filing a complaint is neither a data lookup nor latency-sensitive the way an answer is.

```
Caller reports a problem (mid-call via the agent, or the web form)
        │
        ▼
POST /api/agent/ticket        row written first, before anything else
        │
        ▼
Linear issue                  @devin comment posted — this is what starts a session
        │
        ▼
Devin works the ticket
   ├─ resolved  → issue closed → /triage marks the report resolved
   └─ can't resolve → adds the `needs-engineer` label
                          │
                          ▼
                   Linear webhook → POST /api/linear-webhook → Slack ping
```

Two pages: `/triage` is every report and where it got to, `/report` is the fallback form
for anyone not on a call.

## The webhook contract (for B)

Add this as a webhook tool on the ElevenLabs agent. It is the only endpoint the agent
calls in this component.

```
POST {APP_URL}/api/agent/ticket
Content-Type: application/json
x-support-secret: {SUPPORT_AGENT_SECRET}
```

```jsonc
{
  "note": "What the caller said went wrong.",   // required, 3–2000 chars
  "topic": "Salik exemption",                    // optional, what it was about
  "conversation_id": "conv_abc123",              // optional but send it — joins the transcript
  "caller_contact": "+9715…"                     // optional, only if the caller offers it
}
```

Success is `200`:

```jsonc
{
  "filed": true,
  "reference": "PER-42",          // null if Linear was unreachable — the report is still saved
  "spoken_response": "Your report has been logged as P E R 4 2. Someone will pick it up.",
  "warning": "…"                  // present only when something downstream did not happen
}
```

Read `spoken_response` out loud rather than building your own sentence — the identifier is
spelled for TTS, so the agent says "P E R 4 2" and not "per forty-two".

`400` malformed body · `401` missing or wrong `x-support-secret`. Both return
`{ "error": ... }`. The endpoint refuses to start in production without the secret set: an
open endpoint here means anyone can flood the team's Linear board.

`warning` appears when the report was saved but something downstream did not happen. Do
not read it to the caller — their report is filed either way, and it is our problem, not
theirs. `filed: true` with a null `reference` means exactly that: stored, not yet ticketed.

Send `conversation_id`. Without it the post-call transcript webhook has nothing to join
on, and the ticket carries the caller's summary but not the exchange that produced it.

## Slack

Two things ping Slack, and nothing else does:

1. **Devin was not reached at all** — the issue exists but has no first responder.
2. **Devin escalated** — it worked the ticket, could not resolve it, and added
   `needs-engineer`.

Not new tickets, not state changes, not Devin's progress, not comments. A channel that
pings on every caller report gets muted within a day, and then the two alerts that matter
are missed too. `/triage` is where routine state lives; Slack is only for a loop that has
stalled on a person.

Set up:

- **Slack** → your app → Incoming Webhooks → Add New Webhook to Workspace → paste into
  `SLACK_WEBHOOK_URL`.
- **Linear** → Settings → API → Webhooks → new webhook on **Issues**, URL
  `{APP_URL}/api/linear-webhook`, and paste its signing secret into `LINEAR_WEBHOOK_SECRET`.
  Unsigned or stale-timestamped deliveries are rejected with a 401.

## Landmine: Linear will not assign issues to Devin

`issueCreate` with `assigneeId` pointing at the Devin app user returns `success: true`,
and then leaves the issue assigned to whoever owns the API key. A follow-up `issueUpdate`
does the same. Verified against this workspace — both reported success and changed nothing.

So **assignment is not the handoff**. A comment mentioning `@devin` is the trigger that
survives the API, and it is what actually starts a session. Both are attempted, and the
result is read back and compared by id rather than inferred from `assignee !== null` —
otherwise a loop reaching nobody looks green, because there is always a name on the issue.

## Environment

Copy `.env.example` to `.env.local`. Every integration degrades rather than crashing: a
missing Supabase key falls back to in-process rows, a missing Linear key still stores the
report, and both say so on `/triage`. The three that do not degrade are all secrets, and
deliberately so: `SUPPORT_AGENT_SECRET` (refuses to serve in production),
`LINEAR_WEBHOOK_SECRET` (rejects every delivery), and `ELEVENLABS_WEBHOOK_SECRET` (returns
500 rather than accept an unverified transcript). An open endpoint on any of the three is
worse than a closed one — flooding the Linear board, forging a Slack escalation, and
writing unverified transcripts into the database respectively.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # assertions on the rules worth breaking a build over
npm run typecheck && npm run lint && npm run build
```

## Live deployment

```
https://uae-voice-support-loop.vercel.app
```

| What | Where |
|---|---|
| Agent files a report — registered as the agent's `file_issue` tool, verified on a live call | `POST /api/agent/ticket`, header `x-support-secret` |
| Post-call transcript — the ElevenLabs `post_call_transcription` webhook points here, registered and verifying | `POST /api/elevenlabs-webhook` |
| Escalation in, Slack out — already registered on the Linear team, Issue events | `POST /api/linear-webhook` |
| Audit trail for a demo, no Linear account needed | `/triage` |

Deployed from `SupportLoop/` as the Vercel project root, so `vercel deploy` is run from
this directory rather than the repo root.

Database schema is `supabase/schema.sql`; migrations applied on top live in
`supabase/migrations/`. Escalation is deliberately not a column — Linear is the single
source of truth for ticket state, and a second copy of it is a second thing to be wrong.
