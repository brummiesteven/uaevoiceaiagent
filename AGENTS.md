# AGENTS.md

Read this before changing anything. It is written for the coding agent that picks up a
Linear ticket from a flagged call, and for anyone reviewing that agent's PR.

## Tickets from flagged calls: change these two things only

A ticket produced by `/api/feedback` is a wrong or unhelpful answer on a real call. The fix
is one of exactly two edits:

- **`agent-config/prompt.md`** — the agent behaved wrongly: it guessed instead of refusing,
  skipped the citation, decided eligibility itself, or handed off badly.
- **`content/services/<slug>.json`** — the facts are wrong, missing or stale. Prefer
  `npm run scrape -- <slug>` over hand-editing; hand-edit only when the page itself does not
  publish the fact, and then set nothing you cannot point at on the page.

Do not fix a bad answer by changing application code, the MCP tools, or the schema. If the
ticket genuinely requires that, say so on the ticket instead of doing it.

Merging to `main` runs `.github/workflows/sync-agent.yml`, which pushes the prompt and the
knowledge base to the live agent. A merged PR is a live change — review it that way.

## Facts, and what you are allowed to assert

Every fact in `content/services/*.json` must be on the page at `source.url`. If it is not
there, the correct value is `null` or "Not published on the source page." An invented fee or
deadline about someone's entitlement is a real harm, not a demo bug.

`source.humanVerified` is `false` until a person has compared the JSON against the page. The
service page renders a warning banner while it is false — do not flip it to `true` to remove
the banner.

The committed fixtures were written by hand to unblock the build and are **not** verified
extractions. Treat their values as placeholders until `npm run scrape` has run against the
real pages with a human check.

## Architecture invariants

- `content/schema.ts` is the only content contract. The web pages, the ElevenLabs knowledge
  base document and the MCP tool payloads all derive from it. Change it and you change all
  three — check all three.
- Prose goes to the knowledge base (RAG). Lists and decisions go through MCP tools. Do not
  duplicate prose into tool responses.
- MCP tools answer from committed JSON with no network call. Keep them that way: a tool that
  takes over ~1.5s stalls the agent mid-sentence, which sounds like a hang on a call.
- `check_eligibility` returns `needs_human_review` whenever an answer is missing. Do not add
  a code path that guesses a verdict.
- Every integration is optional at boot (`lib/env.ts`). Do not introduce a module-level throw
  on a missing key.

## Accessibility is not polish

The audience is people of determination. Keep: body text at 1.125rem or larger, visible focus
outlines, 44px minimum targets, AA contrast, labelled form fields, `aria-live` on async
results, no meaning conveyed by colour alone, and no timeouts on any interaction.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run build
npm run scrape -- <slug>
npm run sync:agent -- --dry
npm run test:adversarial
```

`npm run lint`, `npm run typecheck` and `npm run build` all have to pass before a PR.
