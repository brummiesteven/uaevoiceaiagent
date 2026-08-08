# Build plan — 5 people, 3 hours

Window: 3h build + 1h submission. Cut line at **T+2:00**.
The only thing that cannot be cut: the agent answering a real question from scraped
content, with a citation.

---

## Minute zero — 5 minutes, everyone, before any code

| Who | Action | Why |
|---|---|---|
| E | Create public GitHub repo, push empty commit, invite all 5 | All commits must fall inside the build window |
| B | ElevenLabs → Integrations → **enable custom MCP servers** | Off by default per workspace. Silent failure: C's tools exist but the agent never calls them |
| A | Push `content/schema.ts` + 2 hand-written fixture JSONs | Hard dependency — C and D both build against this shape |
| E | Create Supabase project, Linear team, confirm Devin integration installed | Account provisioning is dead time if hit at T+1:00 |
| D | `npx create-next-app`, push, connect Vercel | Everyone needs a deploy URL to wire against |

Nobody waits on the real scrape. **A's fixtures unblock C and D at minute 15.**

---

## Ownership

| | Role | Owns |
|---|---|---|
| **A** | Data & Knowledge | `schema.ts`, Context.dev scrape, ElevenLabs KB + RAG, text adversarial personas |
| **B** | Voice Agent | Agent config, system prompt, refusal guardrail, tuning, `sync-agent.ts` + GH Action |
| **C** | MCP | `/api/mcp`, 3 tools, deploy, wire + verify invocation, audio adversarial personas |
| **D** | Frontend | Service pages, call widget, feedback form, accessibility pass, triage page |
| **E** | Loop & Submission | Supabase, `/api/feedback`, `/api/elevenlabs-webhook`, Linear→Devin, docs, Loom |

---

## A — Data & Knowledge

| Time | Task |
|---|---|
| 0:00–0:15 | `content/schema.ts` + 2 fixture JSONs. **Push immediately** — C and D are blocked until this lands |
| 0:15–0:45 | `scripts/scrape.ts`: Context.dev crawl + structured extraction, 3–5 services only. Check `robots.txt` first. Commit `content/services/*.json` |
| 0:45–1:15 | Upload to ElevenLabs knowledge base, enable RAG, sanity-check retrieval on 5 real questions |
| 1:15–2:30 | Adversarial: 5 personas as ElevenLabs simulation tests with pass/fail criteria — contradictory info, rambling phrasing, prompt injection, out-of-scope request, mid-conversation topic switch |
| 2:30–3:00 | Capture results. **One clean pass and one real failure, on video** |

Budget ~60 Context.dev credits (basic scrape 1, structured extraction 10/page). Free tier is 500.

## B — Voice Agent (critical path)

| Time | Task |
|---|---|
| 0:00–0:05 | **Enable MCP in the ElevenLabs workspace.** Blocks C |
| 0:05–1:00 | Create agent. `agent-config/prompt.md`: cite a source URL for every factual claim; refuse and hand to the helpline when RAG returns nothing |
| 1:00–2:00 | Tune against A's real questions. Attach C's MCP tools when ready. Set up the post-call webhook to E's endpoint |
| 2:00–2:30 | `scripts/sync-agent.ts` — PATCH agent prompt + re-upload KB docs via ElevenLabs API. `.github/workflows/sync-agent.yml` on push to `main` |
| 2:30 | **Agent frozen.** No manual dashboard edits after this. The sync script may still push |

`sync-agent.ts` is what makes a merged Devin PR change the live system. It is the single
most load-bearing 30 lines in the project — do not let it slip past 2:30.

## C — MCP

| Time | Task |
|---|---|
| 0:15–1:30 | `/api/mcp` on Vercel, HTTP streamable. `find_service`, `get_required_documents`, `check_eligibility`. Reads A's JSON |
| 1:30–2:00 | Register in ElevenLabs, attach to agent, **verify the agent actually invokes each tool** — a tool that exists but is never called is exactly the overclaim a spec-vs-code check catches |
| 2:00–3:00 | Join A: render 2 audio personas — TTS caller + mixed dog bark, and mid-sentence Hindi→English switch. Text simulation cannot catch audio-layer failure |

Tools return in <1.5s with small payloads. A slow tool stalls the agent mid-sentence.

## D — Frontend

| Time | Task |
|---|---|
| 0:15–1:15 | Service page from A's JSON (Claude Code — this is the fastest-moving piece) |
| 1:15–1:45 | Embed the ElevenLabs widget. Post-call feedback form → E's `/api/feedback` |
| 1:45–2:15 | `/triage` — flagged calls, transcripts, linked Linear issues |
| 2:15–3:00 | **Accessibility pass.** Keyboard nav, screen-reader labels, AA contrast, no timeouts, visible focus states, large tap targets |

Given the people-of-determination framing, the a11y pass is the differentiator, not polish.
It is scheduled last because it is a pass over finished markup — but it does not get cut.

## E — Loop & Submission

| Time | Task |
|---|---|
| 0:00–0:15 | Repo, Supabase project, Linear team, Devin integration |
| 0:15–1:00 | `supabase/schema.sql` (`call_feedback`, `tickets`). `/api/feedback` → row → Linear issue → assign Devin. `/api/elevenlabs-webhook` → join transcript on `conversation_id` |
| **1:30** | **Fire the first real Devin session.** It needs ~30 min to produce anything |
| 1:00–2:00 | README `[FILL]`s |
| 2:00–2:45 | TECH-SPEC `[FILL]`s, especially section 5 written against actual commit history |
| 2:45–4:00 | Loom (record twice, keep take 2), upload, **set link to "anyone with the link"**, submit |

E writes no feature code. Documentation happens during the build, not after it.

---

## Dependency graph — the only three that bind

```
A: schema.ts (0:15) ──┬──> C: MCP tools
                      └──> D: frontend

B: MCP workspace opt-in (0:05) ──> C can attach tools to agent

E: Devin session fires (1:30) ──> anything to show in the video
```

Everything else runs in parallel.

---

## T+2:00 cut line

Whatever is not working gets written into TECH-SPEC section 5 as v2. Half-built features
cost more than omitted ones — the spec is checked against the code.

Demotion order if you are behind:
1. `/triage` page (D) — describe it instead
2. Audio personas (C) — text simulations alone still demonstrate the suite
3. Devin PR *merged* (E) — a scoped plan comment is an honest partial
4. 5 services → 3 (A)

Never cut: the grounded voice answer with citation, the refusal path, or the a11y pass.

---

## Loom shot list — 2:45

| Time | Shot |
|---|---|
| 0:00–0:20 | The problem. Real government page on screen showing the information sprawl |
| 0:20–1:00 | A successful grounded call, with the citation visible |
| 1:00–1:20 | The refusal path — agent says it does not know and hands off. Demonstrate deliberately |
| 1:20–1:50 | Adversarial: dog-bark pass, then the language-switch failure. **Show the failure** |
| 1:50–2:20 | Caller files the note → Linear issue appears → Devin session opens |
| 2:20–2:45 | Architecture diagram. One honest line on what is real vs. v2 |
