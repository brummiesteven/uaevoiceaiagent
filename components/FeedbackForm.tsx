"use client";

import { useState } from "react";

type Result =
  | { kind: "ok"; message: string; ticketUrl: string | null }
  | { kind: "error"; message: string };

export default function FeedbackForm({
  serviceSlug,
  conversationId,
  helpline,
}: {
  serviceSlug: string;
  conversationId: string | null;
  helpline: string | null;
}) {
  const [note, setNote] = useState("");
  const [manualConversationId, setManualConversationId] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note,
          serviceSlug,
          conversationId: conversationId ?? (manualConversationId.trim() || null),
          callerContact: contact.trim() || null,
        }),
      });
      const body = (await response.json()) as {
        error?: string;
        warning?: string;
        ticket?: { identifier: string; url: string } | null;
      };
      if (!response.ok && body.error) {
        setResult({ kind: "error", message: body.error });
        return;
      }
      setNote("");
      setResult({
        kind: "ok",
        message: body.ticket
          ? `Thank you. This was logged as ${body.ticket.identifier} and assigned to Devin to fix.`
          : `Thank you. Your report was saved.${body.warning ? ` (${body.warning})` : ""}`,
        ticketUrl: body.ticket?.url ?? null,
      });
    } catch (error) {
      setResult({
        kind: "error",
        message: `Could not send your report: ${
          error instanceof Error ? error.message : "unknown error"
        }.${helpline ? ` You can call ${helpline} instead.` : ""}`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h2 id="feedback-heading">Was the answer wrong?</h2>
      <p>
        Tell us what the agent got wrong. Your report opens a ticket that a coding agent picks up,
        and the fix goes live on the agent when it is merged.
      </p>
      <form className="feedback" onSubmit={submit} aria-labelledby="feedback-heading">
        <div className="field">
          <label htmlFor="note">
            What did the agent get wrong?
            <span className="hint"> Required. Say it however you like.</span>
          </label>
          <textarea
            id="note"
            name="note"
            required
            minLength={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {!conversationId && (
          <div className="field">
            <label htmlFor="conversationId">
              Conversation ID
              <span className="hint">
                {" "}
                Optional. Paste it if you have it — it lets us attach the call transcript to your
                report.
              </span>
            </label>
            <input
              id="conversationId"
              name="conversationId"
              type="text"
              value={manualConversationId}
              onChange={(event) => setManualConversationId(event.target.value)}
            />
          </div>
        )}

        <div className="field">
          <label htmlFor="contact">
            How can we reach you?
            <span className="hint"> Optional. Email or phone.</span>
          </label>
          <input
            id="contact"
            name="contact"
            type="text"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
          />
        </div>

        <button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Report a wrong answer"}
        </button>
      </form>

      <div aria-live="polite" style={{ marginTop: "1rem" }}>
        {result && (
          <p className="status" data-kind={result.kind === "error" ? "error" : "ok"}>
            {result.message}{" "}
            {result.kind === "ok" && result.ticketUrl ? (
              <a href={result.ticketUrl}>Open the ticket</a>
            ) : null}
          </p>
        )}
      </div>
    </>
  );
}
