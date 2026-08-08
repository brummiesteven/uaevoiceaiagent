# AlHammadi — MCP Server (component C)

Voice-facing MCP server over Dubai's official open data, plus the practical
living-in-Dubai information a caller actually rings up about.

**New here? Go straight to [SETUP.md](SETUP.md).** It offers two ways to run this — pick
one and follow that section only.

| | **Cloudflare Worker** | **Local + tunnel** |
|---|---|---|
| Speed from ElevenLabs | **1.4s** avg | 4.0s avg |
| Laptop stays on | No | Yes |
| URL changes | Never | Every restart |
| Data | Snapshot, refreshed on deploy | Live, re-read every boot |

**Demoing? Use the Worker.** Nearly 3× faster and the URL never moves.
**Changing tool code? Run it locally.** No deploy step between edit and test.

## What it can answer

| | |
|---|---|
| **598 datasets** from **76 government entities** | what data Dubai publishes, who publishes it, how often |
| **9 headline statistics** | population, daytime population, inflation, GDP growth, households, buildings |
| **10 People of Determination services** | parking permits, free Metro/bus travel, nol card, Salik exemption, accessible taxis, step-free Metro |
| **DEWA tariffs** | electricity and water, with a working bill calculator |

Real exchanges, verified end to end:

> **"I use a wheelchair and I'm moving to Dubai. What help can I get getting around?"**
> "There's quite a bit set up for wheelchair users here. You get free travel on the Metro
> and buses with a special nol card, step-free access with wheelchair spaces on every
> carriage, low-floor buses, wheelchair-accessible taxis around the clock, and if you
> drive, a free parking permit plus Salik toll exemption on one vehicle."

> **"What will my electricity bill be at 2500 units a month?"**
> "Roughly 750 dirhams total — that's DEWA's residential rate, and it climbs a bit more
> per unit the higher your usage goes."

## Why there are two runtimes

Tunnelling to a laptop put **2–3 seconds of round trip on every MCP request**, for work the
server does in 1.5 milliseconds. A spoken turn needs several requests, which is where 20–30
second answers came from. Measured from ElevenLabs, enumerating tools took **3.98s average
via the tunnel and 1.42s at the edge** — and the worst case halved.

The Worker can't fetch data.dubai: its firewall rejects datacenter IPs, verified against
the JSON API and not just the web pages. It doesn't need to. The catalogue was always
loaded once at boot and answered from memory, so the Worker ships it inside the bundle
(137 KB gzipped) and touches the network zero times per request.

Tool definitions are shared by both runtimes via `buildTools()` in `src/tools.js`. The Node
server registers them with the MCP SDK; the Worker speaks JSON-RPC directly, because the
SDK's transports are built around node's http objects. **One source of truth** — two
servers with drifting tool behaviour would be worse than either alone.

## Endpoints

| Path | Purpose |
|---|---|
| `/mcp/voice` | **10 curated tools — point ElevenLabs here** |
| `/mcp` | all 20 tools, for Claude, Cursor, any MCP client |
| `/health` | counts, tool list, whether the catalogue is live or from snapshot |

Two endpoints because tool-selection accuracy falls as the surface grows, and a voice
agent that picks the wrong tool gives a wrong spoken answer the listener can't see. Same
code, one flag.

## Tools

**On voice** — `search_datasets`, `get_dataset`, `list_themes`, `list_entities`,
`browse_by_theme`, `get_dubai_indicator`, `get_population_profile`,
`get_accessibility_service`, `list_accessibility_services`, `get_utility_rates`

**Full endpoint adds** — `find_similar_datasets`, `browse_by_entity`,
`list_popular_datasets`, `list_recent_datasets`, `list_datasets_by_update_frequency`,
`list_subthemes`, `list_publications`, `list_indicators`, `get_dataset_api_info`,
`get_catalogue_stats`

Every tool returns a `speech` string for the agent to read and `structuredContent` for
non-voice clients.

**Tool output is answer-shaped, not catalogue-shaped, and this is load-bearing.** The
model echoes tool text almost verbatim, so a tool that returns "22 datasets matched"
produces an agent that says it. `search_datasets` leads with the single best match and
what it contains; counts stay in `structuredContent`. This matters more than the system
prompt — changing tool text changes what callers hear.

Latency: the catalogue is held in memory, so tool calls return in single-digit
milliseconds, comfortably inside TECH-SPEC's 1.5s budget. Nothing in the voice path
touches the network.

## Where the data comes from

**Catalogue** — `data.dubai/o/c/datasets`, a public unauthenticated Liferay Objects REST
API. Pulled once at boot and cached to disk. No key needed.

**Statistics** (`data/indicators.json`) — published only on data.dubai's rendered pages,
absent from the API. Captured with context.dev.

**Living info** (`data/living-in-dubai.json`) — DEWA tariffs, and People of Determination
entitlements from RTA and Parkin. Also captured with context.dev, since none of it is in
any open-data API.

Row-level dataset access (`apis.data.dubai`) returns **401** — it needs a key granted by
email, so it isn't used. Per-statistic time series need a portal login. The tools tell
callers what exists and how to request access rather than pretending otherwise.

**The captured figures are a point-in-time snapshot and will drift.** Tariffs and
entitlements change, and telling someone they get free parking when they don't is a real
harm — so the tools attach "worth confirming with them" and hand over a phone number or
email.

## Landmines

Every one of these fails **silently** — no error, just a wrong answer.

**Node's global `fetch` returns zero results.** Against data.dubai, multi-word searches
via undici return HTTP 200, valid JSON, and `totalCount: 0`. `curl` and node's `https`
module return 22 for the same URL. All network access goes through `src/http.js` for this
reason — don't swap it back. This also rules out a Cloudflare Workers port, where only
`fetch` exists.

**`URLSearchParams` breaks search.** It encodes spaces as `+`, which this endpoint matches
literally. Percent-encoding is required, so query strings are built by hand.

**Partial pages look like success.** An early version used a 20s timeout and swallowed
page failures, silently serving 399 of 599 datasets. Pages now retry, and a short result
throws.

**Invisible Unicode in publisher names.** "Dubai Data and Statistics Establishment" ships
with U+17B4-type filler that breaks TTS. Stripped in `src/text.js`.

**data.dubai has an F5 WAF.** It rejects datacenter IPs and URLs carrying `?com_dda_*`
params. Scraping must route through a UAE IP and use query-string-free URLs. (DEWA and
RTA don't do this — it's specific to data.dubai.)

**ElevenLabs `simulate-conversation` does not execute MCP tools.** Verified: tool
enumeration reaches the server, simulation sends zero requests, and with no tools the
model invents statistics. **Simulation cannot validate this integration** — test with a
real conversation and watch for `[req] POST /mcp/voice` in the log.

**MCP is off by default per ElevenLabs workspace.** Already enabled on the workspace this
was built against. On a different workspace, enable it under Integrations first — the
symptom is an agent that answers plausibly and never calls a tool.

## Notes for the team

### There are now two MCP servers — this needs a decision

The `support` branch already carries one (`app/api/mcp/route.ts`, `lib/mcp/tools.ts`) with
`find_service`, `get_required_documents` and `check_eligibility`, answering from
hand-curated JSON. **This is not a replacement for it.** They cover different ground:

| | `support` branch | this one |
|---|---|---|
| Answers | how to *apply* for a service — eligibility, documents, steps | what things *cost*, what the data says, what you're entitled to |
| Source | 3 curated service files, deep and checked | 598 live datasets + captured tariffs and entitlements |
| Shape | Next.js route, deploys with the app | standalone Node, runs anywhere |

ElevenLabs accepts multiple MCP servers on one agent (`mcp_server_ids` is an array), so
they can run side by side. My suggestion: the curated service files stay authoritative for
*how to apply* — they carry eligibility rules and document checklists this server has no
equivalent of — and this server stays authoritative for costs, entitlements and data.

**Both describe the People of Determination parking permit, and they disagree.** Worth
reconciling before either is demoed:

| | `support` branch | here |
|---|---|---|
| Issuing body | Roads and Transport Authority | Parkin |
| Fee | "Not published on the source page" | Free |
| Helpline | 800 9090 | 800 7275 |
| Source | a general `u.ae` driving page | `parkin.ae/permit` |
| Verified | `humanVerified: false`, `scrapedAt` 2026-01-01T00:00:00 | scraped 8 Aug 2026 |

Parkin took over Dubai's paid parking operations from RTA, so the authority field on the
curated file looks out of date, and its source URL doesn't cover the permit it describes.
I'd trust this server's figures on issuer and fee, and the curated file on eligibility and
documents. Neither of us should guess — one of us should open the Parkin page and settle
it. Two tools that answer the same question differently is worse than either alone.

### Smaller things

- **This server wasn't blocked on A.** The plan has `A: data source ready ──> C: MCP tools
  can be built`. data.dubai is a live public API needing no credentials, so that
  dependency didn't apply here — worth not blocking anyone else on it.
- **The B/C split needs tighter coupling than the plan implies.** TECH-SPEC says tool
  schemas are C's and "the prompt is what decides when each one gets called". In practice
  tool *descriptions* drive tool selection at least as much as the prompt, and tool
  *return text* drives what the caller hears more than the prompt does. Prompt and tools
  have to be tuned together or you get catalogue-speak read aloud.
- **`gemini-2.0-flash` in `agent-settings.json` doesn't reliably call tools.** Tested: it
  skipped them and invented a Dubai population figure, stated confidently. `claude-sonnet-5`
  works. It's already flagged as a placeholder in that file — this is the evidence.
- **Agent config path has diverged across branches** — `ElevenLabsAgent/` on one,
  `agent-config/` on another. Worth settling before both merge.
- **MCP is off by default per ElevenLabs workspace** and is already enabled on the one
  this was built against, which the plan correctly calls out as a silent-failure risk.

## Layout

```
MCPServer/
  src/
    server.js      HTTP + MCP transport, /mcp and /mcp/voice
    catalogue.js   boot hydration, local ranked search, disk snapshot fallback
    tools.js       all 20 tools; `voice: true` marks the curated subset
    indicators.js  headline statistics
    living.js      DEWA tariffs + accessibility services, slab calculator
    text.js        TTS hygiene, prose shaping
    http.js        the ONLY network access — see landmines
  scripts/
    smoke.js       13 assertions over the real MCP protocol
    reconnect.js   re-point the agent at a new tunnel URL
  worker/
    src/index.js   the same tools as a Cloudflare Worker (JSON-RPC, no SDK)
    src/data.js    GENERATED — the catalogue baked into the bundle
    wrangler.toml
  scripts/
    build-worker-data.js  regenerates worker/src/data.js from the snapshot
  data/            captured figures (catalogue snapshot is generated, not committed)
  agent-prompt.md  tested prompt + why each rule exists
  SETUP.md         start here
```

`src/*-core.js` holds everything both runtimes share — search, ranking, formatting, the
tool definitions. `src/catalogue.js`, `indicators.js` and `living.js` add the parts that
need a filesystem or a network, and are used only by the Node server.
