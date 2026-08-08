# AGENTS.md

Read this before changing anything. It is written for the coding agent (Devin) that picks
up a Linear ticket filed from a real call, and for anyone reviewing that agent's PR.

## Where tickets come from

A ticket is a caller who was unhappy or reported a problem — not necessarily a wrong
answer specifically. It reaches Linear one of two ways, both in `SupportLoop/`:

- `app/api/agent/ticket` — the ElevenLabs agent calls this mid-call as a webhook tool
  (`file_issue` in `ElevenLabsAgent/prompt.md`).
- `app/api/feedback` — the web fallback form (`app/report`), for anyone not on a call.

Both write a row to Supabase first, then call `SupportLoop/lib/linear.ts` to create the
Linear issue and mention `@devin` in a comment to start a session (mentioning is what
actually starts one — assigning via the API silently doesn't, see `TECH-SPEC.md` §6). If
you're reading this because you were mentioned on a ticket, that's this path.

## Tickets from flagged calls: change these two things only

The fix is one of exactly two edits:

- **`ElevenLabsAgent/prompt.md`** — the agent behaved wrongly: it guessed instead of
  refusing, skipped attribution, or narrated its own tool use instead of answering
  naturally.
- **`content/services/<slug>.json`** — a fact rendered on that service's page is wrong,
  missing, or stale.

Do not fix a bad answer by changing `MCPServer/` (C's tools) or `SupportLoop/` (the ticket
pipeline itself) unless the ticket is specifically about one of those. If a fix genuinely
needs application code, say so on the ticket instead of doing it.

Merging to `main` with changes under `ElevenLabsAgent/**` or `content/services/**` runs
`.github/workflows/sync-agent.yml`, which runs `npm run sync-agent` — this PATCHes the live
agent's prompt/settings and re-uploads every `content/services/*.json` file to its
knowledge base. **A merged PR is a live change to the running agent** — review it that way.

## Facts, and what you are allowed to assert

Every `content/services/*.json` file currently has `"fixture": true` (see
`content/schema.ts`) — **they are hand-written placeholders written to unblock the
frontend build, not verified extractions.** There is no `npm run scrape` command in this
repo — a real scrape pipeline (Context.dev, per `TECH-SPEC.md` §3) is v2, not built. Until
it exists, treat every fixture value as a placeholder: don't quote a fee, deadline, or
eligibility rule from a `fixture: true` record as fact in a ticket reply, and when you do
edit one, only set what you can point to on the real page at `sourceUrl` — leave anything
else as it was rather than inventing a number. An invented fee or deadline about someone's
entitlement is a real harm, not a demo bug.

## Architecture invariants

- **`content/schema.ts` is the content contract for the frontend and the agent's knowledge
  base only** — it feeds `app/services/[slug]/page.tsx` and, via `sync-agent.ts`, the
  ElevenLabs knowledge base (prose/RAG). **It has no relationship to `MCPServer/`'s
  tools.** C's MCP tools (`search_datasets`, `get_dataset`, `list_themes`, `list_entities`,
  `browse_by_theme`, `get_dubai_indicator`, `get_population_profile`,
  `get_accessibility_service`, `list_accessibility_services`, `get_utility_rates`) are
  independently coded against data.dubai's live API and Context.dev-captured snapshots
  (`MCPServer/data/*.json`) — changing `content/schema.ts` does not touch them, and there
  is no `check_eligibility` tool or similar in this system.
- MCP tools answer from an in-memory catalogue with no network call in the voice path —
  see `MCPServer/README.md`'s landmines section before touching `MCPServer/src/`. A tool
  call over ~1.5s stalls the agent mid-sentence, which sounds like a hang on a call.
- The agent's own instructions for never narrating tool mechanics, never guessing, and the
  refusal/escalation rules live in `ElevenLabsAgent/prompt.md` — read it before assuming
  what the agent will or won't say.
- Every `SupportLoop/` integration is optional at boot (`SupportLoop/lib/env.ts`) — don't
  introduce a module-level throw on a missing key there.

## Accessibility is not polish

The audience includes People of Determination. Keep: body text at 1.125rem or larger,
visible focus outlines, 44px minimum targets, AA contrast, labelled form fields,
`aria-live` on async results, no meaning conveyed by colour alone, and no timeouts on any
interaction.

## Commands

This repo is three separate Node projects — run commands from inside the right one.

```bash
# root — the Next.js frontend (service pages, voice console, /triage persona board)
npm run dev          # http://localhost:3000
npm run lint
npm run build
npm run sync-agent    # push ElevenLabsAgent/prompt.md + agent-settings.json + content/services/* live

# MCPServer/ — C's MCP server
npm start             # http://localhost:8787
npm run refresh
npm run smoke         # 13 assertions against the real MCP protocol

# SupportLoop/ — D's ticket pipeline
npm run dev
npm run build
npm run lint
npm run test
npm run typecheck
```

There is no `npm run scrape` or `npm run test:adversarial` anywhere in this repo yet —
both are v2 (see `TECH-SPEC.md` §5). Don't reference them in a PR as if they exist.
