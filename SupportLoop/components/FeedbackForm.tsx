"use client";

import { useState } from "react";

type Result =
  | { kind: "ok"; message: string; ticketUrl: string | null }
  | { kind: "error"; message: string };

export default function FeedbackForm() {
  const [note, setNote] = useState("");
  const [topic, setTopic] = useState("");
  const [conversationId, setConversationId] = useState("");
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
          topic: topic.trim() || null,
          conversationId: conversationId.trim() || null,
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
          ? `Thank you. This was logged as ${body.ticket.identifier}.`
          : `Thank you. Your report was saved.${body.warning ? ` (${body.warning})` : ""}`,
        ticketUrl: body.ticket?.url ?? null,
      });
    } catch (error) {
      setResult({
        kind: "error",
        message: `Could not send your report: ${
          error instanceof Error ? error.message : "unknown error"
        }. Please try again.`,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="feedback" onSubmit={submit} aria-labelledby="report-heading">
      <div className="field">
        <label htmlFor="note">
          What went wrong?
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

      <div className="field">
        <label htmlFor="topic">
          What were you asking about?
          <span className="hint"> Optional. For example, parking permits.</span>
        </label>
        <input
          id="topic"
          name="topic"
          type="text"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="conversationId">
          Conversation ID
          <span className="hint">
            {" "}
            Optional. Paste it if the agent read one out — it attaches the call transcript to
            your report.
          </span>
        </label>
        <input
          id="conversationId"
          name="conversationId"
          type="text"
          value={conversationId}
          onChange={(event) => setConversationId(event.target.value)}
        />
      </div>

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
        {submitting ? "Sending…" : "Send report"}
      </button>

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
    </form>
  );
}
