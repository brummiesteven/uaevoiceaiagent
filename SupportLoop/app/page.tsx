import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <h1>Support loop</h1>
      <p>
        When the voice agent fails a caller, this is what catches it. The caller tells the agent
        something is wrong — during the call, without hanging up or filling in anything — and the
        agent files it. That report becomes a ticket, the ticket goes to Devin, and anything Devin
        cannot resolve is flagged for a human engineer instead of sitting there looking handled.
      </p>

      <h2>How a report travels</h2>
      <ol>
        <li>The caller says something is wrong. The agent takes it down and reads back a reference.</li>
        <li>
          The agent calls this service&rsquo;s webhook. A row is written before anything else, so
          the report survives even if the rest of the chain is down.
        </li>
        <li>A Linear issue is created from the row and assigned to Devin.</li>
        <li>
          Devin works it. Resolved tickets close; ones it cannot resolve get labelled{" "}
          <code>needs-engineer</code>.
        </li>
        <li>
          The call transcript arrives separately from ElevenLabs and is attached to the report by
          conversation id.
        </li>
      </ol>

      <p>
        <Link href="/triage">See every report and where it got to</Link>, or{" "}
        <Link href="/report">file one yourself</Link> if you could not finish a call.
      </p>

      <p className="muted">
        Not an official government service. This is the support component of a hackathon project.
      </p>
    </>
  );
}
