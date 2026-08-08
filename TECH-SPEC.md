# TECH-SPEC

## 1. The problem

UAE government service information is public but not accessible. A person of determination
who wants to know whether they qualify for [FILL: the service you picked], what documents
they need, and what it costs has to navigate a multi-level menu, read a long page written
for administrators, and often open a PDF. Screen-reader users hit unlabelled nav. People
with cognitive disabilities hit dense prose. People who are more comfortable speaking than
reading hit a wall entirely.

The information is not missing. It is unreachable by the people who most need it.

**What we built:** you call a number-free voice agent from the service page and ask the
question in plain language. It answers from the actual government page, cites where the
answer came from, and hands you to a human when it does not know.

**Why voice specifically:** [FILL: 2 sentences — tie to the specific access need, not to
"voice is cool". e.g. motor impairment + form fields, low text literacy, blindness + PDFs.]

---

## 2. Architecture

![Architecture: Context.dev extracts government pages into one JSON contract, which feeds the Next.js pages, the ElevenLabs knowledge base and the MCP server; the ElevenLabs agent handles the call and emits a transcript; flagged failures become Linear issues that Devin fixes by PR, and merging re-syncs the live agent.](docs/architecture.svg)

<details>
<summary>Text version of the diagram</summary>

```
                    content/schema.ts  ← the data contract
                            │
   Context.dev ──crawl + structured extract──► content/services/*.json
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   Next.js pages     ElevenLabs KB         MCP server
   (same JSON)       (prose RAG)           (/api/mcp)
        │                   └────► ElevenLabs Agent ◄────┘
        │                              │        ▲
        │  feedback form               │ post-call webhook
        └──────────────► Supabase ◄────┘        │
                            │                   │ sync on merge
                            ▼                   │
                    Linear issue ──► Devin ──► PR to
                                              agent-config/prompt.md
                                              content/services/*.json
                                                    │
                              merge → GH Action → scripts/sync-agent.ts
                                              → ElevenLabs API + Vercel
```

</details>

### The data path

**One scrape, three consumers.** `content/schema.ts` defines the shape Context.dev extracts
into. That same shape is the props for the web page, the document format uploaded to the
ElevenLabs knowledge base, and the index the MCP tools query. Changing the schema changes
all three. This is deliberate — it is why there is no separate CMS, no separate vector
store, and no content sync job.

**Static vs. dynamic split.** Prose (service descriptions, eligibility narrative, fees) goes
into the ElevenLabs knowledge base and is retrieved by its built-in RAG. Structured lookups
go through MCP tools:

| Tool | Returns |
|---|---|
| `find_service(query)` | matching service slugs + one-line summaries |
| `get_required_documents(service_id)` | document checklist |
| `check_eligibility(service_id, criteria)` | qualifies / does not / needs human review |

Tools return in under 1.5s and return small payloads. A slow or verbose tool stalls the
agent mid-sentence, which in a voice interface reads as a hang.

### The customer surface

**It is a service page with a voice agent attached, not a dashboard.** The page and the
agent read the same JSON, so the screen is a visual rendering of exactly what the agent
knows. Nothing is on the page the agent cannot discuss; nothing the agent claims is absent
from the page. That property falls out of the single-schema decision above rather than
being separately engineered.

Two routes:

- `/` — "What do you need help with?" 3–5 services as large targets. Nothing else.
- `/services/[slug]` — the whole product, moving through three states in place.

The page sections are not a design choice. They are `content/schema.ts` fields, and each
one is simultaneously a page section, a knowledge base chunk, and an MCP tool return:

| Schema field | Page section | Also feeds |
|---|---|---|
| `summary` | intro paragraph | knowledge base |
| `whoQualifies[]` | Who qualifies | knowledge base + `check_eligibility` |
| `documentsRequired[]` | Documents you need | `get_required_documents` |
| `fees[]` | What it costs | knowledge base |
| `howToApply[]` | How to apply | knowledge base |
| `sourceUrl`, `lastScrapedAt` | footer citation | the agent's citation string |

**Three states, one page.** Idle: summary, call button above the fold, the rendered
sections, source citation and helpline in the footer. In call: the transcript renders live
beneath the widget. After call: the transcript persists, joined by a plain-language summary,
the citations the agent used, and the feedback form pre-filled with `conversation_id`.

**The live transcript is an accessibility requirement, not a feature.** A voice-only
interface excludes deaf and hard-of-hearing users — it would be differently inaccessible
rather than accessible. Rendering the agent's speech as text during and after the call is
what makes the dual-modality claim true. It also serves people who cannot retain spoken
information on one hearing, which is a large share of the intended audience.

Consequence for implementation: we use the `@elevenlabs/react` SDK rather than the drop-in
`<elevenlabs-convai>` embed. The embed is faster to wire but is a black box that does not
surface message events, so a self-rendered transcript, inline citation chips, and text
status announcements are all impossible with it. Roughly thirty minutes of additional work
buys the entire accessibility argument.

**What the customer surface deliberately does not have:** accounts, call history, saved
services, personalisation, and a text chat input. If a screen would only make sense to a
returning logged-in user, it is v2. The intended user has one task and may perform it once.

### The repair path

1. Call ends. Caller uses the post-call form to flag a bad answer. Row written to
   `call_feedback` with `conversation_id` and the caller's note.
2. ElevenLabs fires `post_call_transcription` to `/api/elevenlabs-webhook`. We join on
   `conversation_id` and attach the full transcript to the row.
3. `/api/feedback` opens a Linear issue containing the note, the transcript, and the
   service involved, and assigns it to Devin.
4. Devin opens a PR against `agent-config/prompt.md` (behavioural fix) or
   `content/services/*.json` (factual fix, optionally by re-running `npm run scrape`).
5. **Merging that PR runs `scripts/sync-agent.ts`,** which PATCHes the live agent's prompt
   and re-uploads knowledge base documents via the ElevenLabs API, and redeploys the MCP
   server and frontend on Vercel.

Step 5 is the point of the project. Without it the loop is a ticketing system.

---

## 3. Tool rationale

### Context.dev — the data contract

Used for structured extraction against our own JSON schema, not just markdown conversion.
That is what makes it load-bearing rather than a one-off convenience: five government pages
with five different layouts come back in one identical shape, and three downstream systems
depend on that shape.

Remove it and there is no content contract — the frontend, the knowledge base, and the MCP
index all lose their source.

*Alternative rejected:* hand-writing the JSON. Faster for five pages, but it does not scale
to the [FILL: number] services in v2, and it gives us no refresh path when a government page
changes.

### ElevenLabs — the agent and the evidence

Two load-bearing roles:

1. **The agent.** It is the orchestrator during a call — STT, LLM turn, TTS, turn-taking,
   interruption handling, and knowledge base RAG. We deliberately did **not** build a custom
   orchestration layer between the MCP server and the agent: that inserts an extra LLM
   round-trip inside a real-time loop, and voice conversation degrades badly past ~800ms of
   dead air.
2. **The test harness and the evidence trail.** The adversarial suite uses ElevenLabs'
   simulation test type for text-layer failures and ElevenLabs TTS to render caller audio
   for acoustic failures. The post-call webhook is what produces the transcript the repair
   loop consumes.

Remove it and there is no call, and no failure signal to repair from.

### Devin — the repair path

Devin is in the deployed system, not just in our editor. It consumes tickets generated by
real call failures and opens PRs against a deliberately narrow surface:
`agent-config/prompt.md` and `content/services/*.json`.

The surface is narrow on purpose. Config-as-code that an agent can edit correctly in fifteen
minutes is a real capability; asking an agent to refactor application code inside a build
window is not.

Remove it and flagged failures accumulate as tickets that nobody actions.

### Interface decisions, and what we rejected

**No admin authentication, and no unified portal.** The customer surface and the internal
view share almost nothing: one is a first-time visitor on a screen reader who needs plain
language and large targets, the other is us, twice, reading a dense table during a demo. A
unified portal forces shared navigation and layout on two things with opposing
requirements, and the customer page ends up inheriting admin chrome — which actively
damages the accessibility goal. Concretely, auth would have cost the frontend owner 30–45
minutes taken directly from the accessibility work.

`/triage` is therefore a separate, unlinked, unauthenticated route. **All call data in this
build is synthetic, generated by the adversarial suite; no member of the public has used
the system, so no personal data exists in it.** Authentication and role-based access are v2
and are required before any real caller touches it.

**`/triage` is an evidence board, not an analytics dashboard.** We considered call-volume
metrics, success-rate charts, and common-question breakdowns and rejected them: over the
fourteen or so calls this build will generate, a time series is visual padding, and sparse
charts signal that the loop has not actually run. The page instead shows the adversarial
run as one table with expandable rows — persona, pass/fail, call count, transcript, and the
Linear issue and Devin PR each failure produced. It exists so a reviewer can verify this
document against the running system in ten seconds.

**No accessibility overlay widget.** Third-party accessibility toolbars are opposed by
screen-reader users and disability advocacy organisations, and they do not fix underlying
markup. Accessibility here is semantic HTML, correct heading order, live regions, focus
management and contrast — written that way from the first commit rather than retrofitted.
For the same reason there is no dark-mode toggle and no font-size switcher: the browser and
the operating system already provide both, better than we would.

### Supporting choices

- **Next.js on Vercel** — one deployment holds the frontend, the MCP route, the feedback
  API, and the webhook receiver. Four services would have been four sets of env vars and
  four things to debug.
- **Supabase** — one Postgres, two tables (`call_feedback`, `tickets`). Not two databases.
- **Linear** — the Devin integration means assignment starts a session; no glue code.

---

## 4. Build-window feasibility

Window: [FILL: N] hours. Team: 5.

| Owner | 0:00 | 1:00 | 2:00 | 2:30–3:00 |
|---|---|---|---|---|
| P1 | agent + prompt + refusal guardrail | tune, wire MCP tools | `sync-agent.ts` | agent frozen |
| P2 | Context.dev schema + scrape | KB upload + RAG index | adversarial personas | capture results |
| P3 | MCP server, 3 tools | deploy + wire to agent | join P2 on audio personas | — |
| P4 | Next.js service page from JSON | call widget + feedback form | accessibility pass | — |
| P5 | Supabase + feedback → Linear → Devin | README | TECH-SPEC | submission + Loom |

**Sequencing constraints that actually bind:**

- ElevenLabs MCP is disabled per workspace by default. Enabling it is minute zero, or P3's
  work cannot be attached to the agent at all.
- P2's schema must land before P3 and P4 start, since both read that shape. It is the only
  hard dependency in the graph.
- The Devin session fires at T+1:30 so it has time to produce something inside the window.
- P5 writes documentation while the build happens, not after it.

**Cut line at T+2:00.** Anything not working is demoted to section 5 rather than left
half-built. The only thing that cannot be cut is the agent answering a real question from
scraped content with a citation.

**What we cut before starting, and why:**

- A custom orchestration layer between MCP and the agent — latency, described above.
- Two live agents duplexing a real phone call — telephony plumbing with no demo payoff over
  a rendered caller.
- Full Arabic support — [FILL: partial or none]. RTL layout without a native speaker
  reviewing the copy would be worse than honest English-only.

---

## 5. What is real vs. what is v2

Written at T+2:00 against the actual commit history. Be exact here — an overclaim costs
more than an omission.

### Working in the submitted build

- [FILL]
- [FILL]

### Partially working

- [FILL: e.g. "Devin opened a session and posted a scoped plan; the PR was not merged
  inside the window."]

### Not built — v2

- **Wider service coverage.** [FILL: N] services now; the schema and scrape script already
  generalise, the constraint was Context.dev credits and review time.
- **Arabic, properly.** RTL layout, Arabic TTS voice, and a native-speaker review of every
  scraped fact.
- **Authentication and role-based access.** Required before any real caller uses the system,
  since `/triage` exposes transcripts. Unnecessary in this build because every transcript in
  it is synthetic.
- **Operational analytics.** Call volume, resolution rate, and question clustering become
  meaningful at a few hundred calls. At fourteen they would be decoration.
- **Human handoff that actually transfers.** Today the agent gives the helpline number; v2
  warm-transfers to a staffed line.
- **Continuous adversarial regression.** Run the persona suite on every merged Devin PR so
  a fix cannot silently break a previously passing case.
- **Verified-fix loop.** Today a merged PR syncs to the agent. v2 re-runs the specific
  failing conversation against the patched agent and closes the Linear issue only if it
  now passes.
- [FILL: anything you cut at 2:00]

---

## 6. Honest risks

- **Wrong answers about entitlements are a real harm,** not a demo bug. The agent is
  instructed to cite a source URL for every factual claim and to refuse when RAG returns
  nothing, handing off to [FILL: helpline]. That path is demonstrated deliberately in the
  video rather than hidden.
- **Scraped content goes stale** when a government page changes. `npm run scrape -- <slug>`
  is the refresh path; nothing automatic runs today.
- **Not an official service.** No affiliation with any UAE government entity. Built on
  publicly accessible pages; `robots.txt` checked before scraping.
