# [FILL: product name]

Voice access to UAE government services for People of Determination.

Government service information is spread across long pages, PDFs, and nested menus.
This project turns a set of government service pages into a voice agent you can call
and ask a plain-language question — and closes the loop when the agent gets it wrong.

**Live demo:** [FILL: Vercel URL]
**Demo video:** [FILL: Loom link — set to "anyone with the link"]

![Architecture: Context.dev extracts government pages into one JSON contract, which feeds the Next.js pages, the ElevenLabs knowledge base and the MCP server; the ElevenLabs agent handles the call and emits a transcript; flagged failures become Linear issues that Devin fixes by PR, and merging re-syncs the live agent.](docs/architecture.svg)

---

## What it does

1. **Scrapes** 3–5 government service pages with Context.dev into a single typed JSON shape.
2. **Serves** that JSON three ways: accessible web pages, an ElevenLabs knowledge base, and an MCP server.
3. **Answers** questions over voice via an ElevenLabs agent that cites its source and refuses to guess.
4. **Repairs itself** — a caller flags a bad answer, that becomes a Linear issue with the
   transcript, Devin opens a PR against the agent's prompt or content, and merging it
   syncs the change straight back into the live agent.

---

## What you see

**`/services/[slug]`** is the product — a service page with a voice agent attached, not a
dashboard. The page and the agent read the same JSON, so the screen shows exactly what the
agent knows. It moves through three states in place:

- **Idle** — plain-language summary, the call button above the fold, then who qualifies,
  documents needed, costs and how to apply. Source link and helpline in the footer.
- **In call** — the transcript renders live beneath the widget, with the agent's status as
  text and a citation chip next to each grounded claim.
- **After the call** — the transcript stays on the page, joined by a summary, the sources
  used, and the feedback form that starts the repair loop.

The live transcript is an accessibility requirement rather than a feature: a voice-only
interface excludes deaf and hard-of-hearing users, and many people cannot retain spoken
information on one hearing.

**`/triage`** is an evidence board — one table showing each adversarial persona, whether it
passed, its transcript, and the Linear issue and Devin PR any failure produced. It is
unlinked and unauthenticated; all call data in this build is synthetic. See `TECH-SPEC.md`
for why, and what that requires before real callers use it.

---

## Requirements

- Node 20+
- Accounts: [Context.dev](https://www.context.dev/), [ElevenLabs](https://elevenlabs.io/),
  [Supabase](https://supabase.com/), [Linear](https://linear.app/), [Devin](https://devin.ai/)
- A Vercel account for deployment

---

## Setup

```bash
git clone [FILL: repo URL]
cd [FILL: repo name]
npm install
cp .env.example .env.local
```

Fill `.env.local`:

| Variable | Where to get it |
|---|---|
| `CONTEXT_API_KEY` | Context.dev dashboard → API keys |
| `ELEVENLABS_API_KEY` | ElevenLabs → Profile → API keys |
| `ELEVENLABS_AGENT_ID` | ElevenLabs → Agents → your agent |
| `ELEVENLABS_WEBHOOK_SECRET` | ElevenLabs → Webhooks (created when you add the post-call webhook) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project settings → API |
| `LINEAR_API_KEY` | Linear → Settings → API → Personal API keys |
| `LINEAR_TEAM_ID` | Linear → team settings, or `query { teams { nodes { id name } } }` |

### One-time platform setup

1. **Supabase** — run `supabase/schema.sql` in the SQL editor. Creates `call_feedback` and `tickets`.
2. **ElevenLabs MCP opt-in** — MCP servers are disabled per workspace by default.
   Enable it at Agents → Integrations before step 4, or the agent silently gets no tools.
3. **ElevenLabs post-call webhook** — point it at `https://<your-deploy>/api/elevenlabs-webhook`,
   event type `post_call_transcription`.
4. **Register the MCP server** — Agents → Integrations → Add Custom MCP Server →
   `https://<your-deploy>/api/mcp`, transport: HTTP streamable. Attach it to the agent.
5. **Linear + Devin** — install the Devin integration in Linear so an assigned issue
   starts a session.

---

## Run

```bash
npm run scrape          # Context.dev → content/services/*.json  (commit the output)
npm run sync:agent      # pushes agent-config/prompt.md + KB docs to ElevenLabs
npm run dev             # http://localhost:3000
```

Re-scrape a single service after a government page changes:

```bash
npm run scrape -- sanad-card
```

### Adversarial test suite

```bash
npm run test:adversarial          # 5 personas via ElevenLabs simulation tests
npm run test:adversarial:audio    # 2 personas rendered to real audio (noise, code-switching)
```

Results land in `scripts/adversarial/results/`.

---

## Deploy

```bash
vercel --prod
```

Set the same env vars in the Vercel dashboard. Merging to `main` runs
`.github/workflows/sync-agent.yml`, which re-runs `npm run sync:agent` — this is what
makes a merged Devin PR take effect on the live agent without anyone touching a dashboard.

---

## Repo layout

```
content/
  schema.ts                    the extraction contract — one shape, three consumers
  services/*.json              Context.dev output (committed)
agent-config/
  prompt.md                    agent system prompt — Devin edits this
scripts/
  scrape.ts                    Context.dev crawl + structured extraction
  sync-agent.ts                pushes prompt + KB to the live ElevenLabs agent
  adversarial/                 the 5 caller personas
app/
  services/[slug]/page.tsx     service page + call widget + feedback form
  triage/page.tsx              flagged calls and their tickets
  api/mcp/route.ts             MCP server
  api/feedback/route.ts        feedback → Supabase → Linear → Devin
  api/elevenlabs-webhook/route.ts   attaches transcript to the feedback row
supabase/schema.sql
```

---

## Known limits

See `TECH-SPEC.md` → "What is real vs. what is v2". Short version: [FILL: 1 sentence,
written at T+2:00 when the cut line lands].
