# TECH-SPEC

## 1. The problem

UAE government/open data is public but not accessible in the form most people can use.
A person who wants an answer to a plain-language question has to find the right page,
find the right dataset, and read it. Voice removes that navigation step entirely: ask
the question, get the answer.

**What we built:** a caller speaks a question to an ElevenLabs voice agent. The agent
decides what data it needs, calls the right tool on an MCP server, and speaks the answer
back — no app, no page to navigate, no menu.

---

## 2. Architecture

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

The ElevenLabs agent is the only decision-maker and the only connector in this system:

1. The user speaks a question.
2. The agent's LLM decides whether it needs data to answer, and if so, which MCP tool to
   call and with what arguments.
3. The MCP server executes the tool against the data source and returns a result.
4. The agent turns that result into a spoken answer and delivers it to the user.

There is deliberately no orchestration layer between the agent and the MCP server, and no
intermediate service sitting between the agent's decision and the tool call — the agent
talks to MCP directly. Inserting an extra hop there adds a round-trip inside a real-time
voice loop, and conversation quality degrades badly past ~800ms of dead air.

### Roles

| Component | Owner | Responsibility |
|---|---|---|
| ElevenLabs Agent | B | Prompt, decision logic (which tool to call and when), voice/accent tuning, citation and refusal behaviour |
| MCP Server | C | Exposes tools, queries the data source, returns results the agent can turn into speech |
| Data source | A | The underlying data the MCP server's tools read from |
| Support loop | D | Ticket database, the webhook the agent calls to file an issue, Linear → Devin wiring |

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
Ticket database  — a ticket row is written
        │
        ▼
Linear issue  — created from the ticket, assigned to Devin
        │
        ▼
Devin (Cognition)  — works the ticket
   ├─ resolved → ticket closed
   └─ can't resolve → flagged: engineer needed
```

This is **not** an MCP tool call. MCP tools exist to answer the caller's question from
the data source under a 1.5s budget; filing an issue is neither a data lookup nor
latency-sensitive in the same way, and conflating the two paths would make it unclear
which failures belong to "the agent couldn't find data" versus "the agent itself failed
the caller." The agent reaches the ticket-filing webhook directly, the same way it
reaches MCP directly — no orchestration layer here either.

The agent should offer this path whenever a caller expresses dissatisfaction or asks to
file a complaint, whether that happens mid-conversation or as the call is wrapping up.
See `ElevenLabsAgent/prompt.md` for the exact trigger and confirmation wording once D's
webhook endpoint exists.

Devin is the first responder on every ticket. Devin resolves what it can; anything it
cannot resolve is flagged so a human engineer picks it up — tickets should not sit
unowned.

---

## 3. Why ElevenLabs as the agent layer

The agent is the orchestrator for the entire call — STT, LLM turn, TTS, turn-taking, and
interruption handling all happen inside it. We deliberately did not build a custom
orchestration layer between the MCP server and the agent, for the latency reason above.

Remove the agent and there is no call and no way for the user to reach the data at all —
it is the only interface to the system.

---

## 4. Why the support loop exists

Wrong or unhelpful answers are going to happen — the agent can refuse to guess, but it
cannot guarantee every caller leaves satisfied. Without a way to report that, unhappy
callers just hang up and the team never finds out. The support loop turns "the agent
failed this caller" into a ticket someone (or something) actually acts on, instead of a
silently lost call.

Devin working tickets first, with an explicit escalation to a human engineer when it
can't resolve something, means the loop doesn't quietly stall on hard problems — every
ticket ends up either closed or visibly flagged for a person.

Remove this loop and there is no way to know when the agent is failing callers, and no
path from a caller's complaint to a fix.

---

## 5. What is real vs. what is v2

- [FILL: update as the agent, MCP server, and data source land]

---

## 6. Honest risks

- **Wrong or unsupported answers are a real harm,** not a demo bug — the agent should
  cite what backs a claim and refuse rather than guess when the MCP server returns
  nothing.
- **Data can go stale** depending on how the data source (A) is refreshed — no automatic
  refresh is assumed here; see A's docs once they land.
- **A ticket that Devin can't resolve and that never reaches an engineer is worse than no
  loop at all** — it looks handled but isn't. The escalation flag only helps if someone is
  actually watching for it; who that is isn't decided yet.
- [FILL: any scope/authorisation notes once the data source is confirmed]
