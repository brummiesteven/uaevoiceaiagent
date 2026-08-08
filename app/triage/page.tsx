import { listTriage, storeBackend } from "@/lib/store";
import { TranscriptTurn } from "@/lib/types";

export const dynamic = "force-dynamic";

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

export default async function TriagePage() {
  const rows = await listTriage();
  return (
    <>
      <h1>Flagged calls</h1>
      <p>
        Every call a caller flagged as wrong, the transcript the post-call webhook attached, and the
        ticket it became.
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
              <th scope="col">Ticket</th>
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
                  {row.ticket?.linearUrl ? (
                    <a href={row.ticket.linearUrl}>{row.ticket.linearIdentifier}</a>
                  ) : (
                    <span className="muted">Not ticketed</span>
                  )}
                  {row.ticket?.assignee ? (
                    <>
                      <br />
                      <span className="muted">Assigned to {row.ticket.assignee}</span>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
