import fs from "node:fs";
import path from "node:path";
import { personas } from "@/scripts/adversarial/personas";
import { fetchIssueStates, LinearIssueState } from "@/lib/linear";
import { listTriage, storeBackend } from "@/lib/store";
import { Ticket as TicketType, TranscriptTurn } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The evidence board, not an analytics dashboard. Call volume and average duration
 * would say nothing about whether the agent is right; these two tables are the whole
 * claim the project makes — the agent survives callers designed to break it, and when
 * it does not, the failure becomes a ticket a coding agent picks up.
 */

type Summary = {
  ranAt: string;
  results: { persona: string; passed: boolean; failed: string[] }[];
};

/** Written by `npm run test:adversarial` and committed, so the deploy can show it. */
function readAdversarialSummary(): Summary | null {
  try {
    const file = path.join(process.cwd(), "scripts", "adversarial", "results", "summary.json");
    return JSON.parse(fs.readFileSync(file, "utf8")) as Summary;
  } catch {
    return null;
  }
}

function Transcript({ turns }: { turns: TranscriptTurn[] }) {
  return (
    <details className="transcript">
      <summary>Transcript ({turns.length} turns)</summary>
      {turns.map((turn, index) => (
        <p className="transcript-turn" key={index}>
          <b>{turn.role === "agent" ? "Agent" : "Caller"}</b>
          {turn.message}
        </p>
      ))}
    </details>
  );
}

/**
 * The whole trail in one cell. The Linear identifier and state are printed rather than
 * linked because the workspace is private; the attachments Devin adds — the branch, then
 * the pull request — are public, and those are the links worth following.
 */
function Ticket({ ticket, issue }: { ticket: TicketType; issue?: LinearIssueState }) {
  return (
    <>
      <b>{issue?.identifier ?? ticket.linearIdentifier ?? "Ticket"}</b>
      <br />
      {issue ? (
        <>
          {issue.state}
          <br />
          <span className="muted">{issue.title}</span>
        </>
      ) : (
        <span className="muted">
          {ticket.linearUrl ? "State unavailable — Linear not readable from this deploy" : "Created"}
        </span>
      )}
      {ticket.assignee ? (
        <>
          <br />
          <span className="muted">Assigned to {ticket.assignee}</span>
        </>
      ) : null}
      {issue?.links.map((link) => (
        <span key={link.url}>
          <br />
          <a href={link.url}>{link.title}</a>
        </span>
      ))}
      {ticket.devinSessionUrl ? (
        <>
          <br />
          <a href={ticket.devinSessionUrl}>Devin session</a>
        </>
      ) : null}
    </>
  );
}

export default async function TriagePage() {
  const rows = await listTriage();
  // Read the issues rather than linking to them: Linear is a private workspace, so a link
  // is a dead end for anyone reviewing this who is not on the team.
  const issues = await fetchIssueStates(
    rows.map((r) => r.ticket?.linearIssueId).filter((id): id is string => Boolean(id)),
  );
  const summary = readAdversarialSummary();
  const byPersona = new Map(summary?.results.map((r) => [r.persona, r]) ?? []);

  return (
    <>
      <h1>Evidence</h1>
      <p>
        Two things are on this page: how the agent held up against callers built to break it,
        and every call a real caller flagged as wrong along with the ticket it became.
      </p>

      <h2>Adversarial callers</h2>
      <p>
        Five simulated callers, each targeting one failure mode, with criteria checkable from
        the transcript. Run with <code>npm run test:adversarial</code>.
        {summary ? ` Last run ${new Date(summary.ranAt).toLocaleString("en-GB")}.` : ""}
      </p>
      {!summary && (
        <p className="notice">
          The suite has not been run on this deploy yet, so no verdicts are shown — only the
          personas that will run.
        </p>
      )}
      <table className="triage">
        <caption>{personas.length} personas</caption>
        <thead>
          <tr>
            <th scope="col">Caller</th>
            <th scope="col">Failure mode it targets</th>
            <th scope="col">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {personas.map((persona) => {
            const result = byPersona.get(persona.id);
            return (
              <tr key={persona.id}>
                <th scope="row">{persona.id}</th>
                <td>
                  {persona.targets}
                  {persona.audio ? (
                    <>
                      <br />
                      <span className="muted">Also run as audio: {persona.audio.note}</span>
                    </>
                  ) : null}
                </td>
                {/* Pass/fail in words, never colour alone. */}
                <td>
                  {!result ? (
                    <span className="muted">Not run</span>
                  ) : result.passed ? (
                    "Passed"
                  ) : (
                    `Failed: ${result.failed.join(", ")}`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Calls a caller flagged</h2>
      <p>
        The transcript is attached by the post-call webhook, which arrives after the caller has
        already flagged the call — the two halves join on the conversation id. The ticket state is
        read from Linear on each load, so you can follow a flagged call through to the pull request
        that fixed it without an account on our workspace.
      </p>
      {storeBackend() === "memory" && (
        <p className="notice">
          Supabase is not configured, so these rows are held in the server process and disappear on
          restart. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      )}

      {rows.length === 0 ? (
        <p>No calls have been flagged yet.</p>
      ) : (
        <table className="triage">
          <caption>{rows.length} flagged calls, newest first</caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Service</th>
              <th scope="col">What the caller said</th>
              <th scope="col">Ticket and repair</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString("en-GB")}</td>
                <td>{row.serviceSlug ?? "—"}</td>
                <td>
                  {row.note}
                  {row.transcript ? (
                    <Transcript turns={row.transcript} />
                  ) : (
                    <p className="muted" style={{ margin: "0.4rem 0 0" }}>
                      Transcript not attached
                      {row.conversationId ? "" : " (no conversation id captured)"}.
                    </p>
                  )}
                </td>
                <td>
                  {!row.ticket ? (
                    <span className="muted">Not ticketed</span>
                  ) : (
                    <Ticket ticket={row.ticket} issue={issues.get(row.ticket.linearIssueId ?? "")} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
