import {
  ESCALATION_LABEL,
  fetchIssueStates,
  findDevinUserId,
  isClosed,
  LinearIssueState,
} from "@/lib/linear";
import { slackConfigured } from "@/lib/slack";
import { listTriage, markResolved, storeBackend } from "@/lib/store";
import { Ticket as TicketType, TranscriptTurn, TriageRow } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every report and where it got to. Not an analytics dashboard — call volume says nothing
 * about whether anyone was helped. The only number worth putting at the top is how many
 * tickets are waiting on a human, because that is the failure mode TECH-SPEC calls worse
 * than having no loop at all.
 */

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
          {issue.escalated ? <b>Needs an engineer</b> : issue.state}
          <br />
          <span className="muted">{issue.title}</span>
        </>
      ) : (
        <span className="muted">
          {ticket.linearUrl ? "State unavailable — Linear not readable from this deploy" : "Created"}
        </span>
      )}
      <br />
      <span className="muted">{ticket.assignee ? `Assigned to ${ticket.assignee}` : "Unassigned"}</span>
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
  const [issues, devinUserId] = await Promise.all([
    fetchIssueStates(
      rows.map((r) => r.ticket?.linearIssueId).filter((id): id is string => Boolean(id)),
    ),
    findDevinUserId(),
  ]);

  const issueFor = (row: TriageRow) => issues.get(row.ticket?.linearIssueId ?? "");

  // Linear is where work actually closes, so let our status follow it rather than lead it.
  await markResolved(
    rows.filter((r) => r.status !== "resolved" && issueFor(r) && isClosed(issueFor(r)!)).map((r) => r.id),
  );

  const escalated = rows.filter((r) => issueFor(r)?.escalated);
  // Escalations first, then newest. A ticket waiting on a human should never be below the
  // fold because it happens to be old — that is exactly how one gets forgotten.
  const ordered = [...escalated, ...rows.filter((r) => !issueFor(r)?.escalated)];

  return (
    <>
      <h1>Reports</h1>
      <p>
        Every problem a caller reported, and where it got to. Ticket state is read from Linear on
        each load, so the trail runs from a caller&rsquo;s complaint through to the pull request
        that fixed it without needing an account on our workspace.
      </p>

      {/* Without this the page reads as a working Devin loop when nothing is picking
          tickets up — the assignee shown is whoever the API key belongs to, not Devin. */}
      {!devinUserId && (
        <p className="notice">
          Devin is not in this Linear workspace, so no ticket below has been handed to it.
          Install the Devin integration in Linear, or set <code>LINEAR_DEVIN_USER_ID</code>.
        </p>
      )}

      {/* An escalation that only shows on a page nobody has open has not reached anyone. */}
      {!slackConfigured() && (
        <p className="notice">
          Slack is not configured, so escalations show here but nobody is notified. Set{" "}
          <code>SLACK_WEBHOOK_URL</code>.
        </p>
      )}

      {storeBackend() === "memory" && (
        <p className="notice">
          Supabase is not configured, so these rows are held in the server process and disappear on
          restart. Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>SUPABASE_SERVICE_ROLE_KEY</code>.
        </p>
      )}

      <p className="banner" data-kind={escalated.length > 0 ? "attention" : undefined}>
        {escalated.length === 0
          ? "No tickets are waiting on a human engineer."
          : `${escalated.length} ticket${escalated.length === 1 ? "" : "s"} Devin could not resolve ${
              escalated.length === 1 ? "is" : "are"
            } waiting on a human engineer.`}{" "}
        <span className="muted">
          Escalation is the <code>{ESCALATION_LABEL}</code> label in Linear.
        </span>
      </p>

      {rows.length === 0 ? (
        <p>Nothing has been reported yet.</p>
      ) : (
        <table className="triage">
          <caption>
            {rows.length} report{rows.length === 1 ? "" : "s"}, escalations first
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Came in via</th>
              <th scope="col">What the caller said</th>
              <th scope="col">Ticket and repair</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString("en-GB")}</td>
                <td>
                  {row.source === "voice" ? "The agent, mid-call" : "Web form"}
                  {row.topic ? (
                    <>
                      <br />
                      <span className="muted">{row.topic}</span>
                    </>
                  ) : null}
                </td>
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
                    <Ticket ticket={row.ticket} issue={issueFor(row)} />
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
