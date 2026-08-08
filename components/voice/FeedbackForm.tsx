"use client";

import { useState, type FormEvent } from "react";
import styles from "./FeedbackForm.module.css";

type FeedbackFormProps = {
  conversationId: string | null;
  serviceSlug: string;
  isMock: boolean;
};

/**
 * Revealed automatically when a call ends. Posts to /api/feedback (role E's
 * endpoint — not implemented here). Simulated calls short-circuit the POST
 * entirely and say so in the confirmation, so nothing fake reaches Supabase.
 */
export function FeedbackForm({ conversationId, serviceSlug, isMock }: FeedbackFormProps) {
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isMock) {
      void fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, service_slug: serviceSlug, note }),
      }).catch(() => {
        // Post-call feedback is best-effort; the confirmation still shows.
      });
    }

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className={styles.card} role="status">
        <h3>Thanks — that helps</h3>
        <p>
          {isMock
            ? "This was a simulated call, so nothing was sent to the repair queue. On a live call, this note and the transcript open a ticket automatically."
            : "Your note and the transcript have been sent to the repair queue."}
        </p>
      </div>
    );
  }

  return (
    <form className={styles.card} onSubmit={handleSubmit}>
      <h3>How did that call go?</h3>
      <p>If anything the agent said was wrong or unclear, tell us — this is what starts a fix.</p>
      <label htmlFor="feedback-note" className={styles.label}>
        What happened?
      </label>
      <textarea
        id="feedback-note"
        className={styles.textarea}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={4}
        placeholder="e.g. It gave the new-card fee but not the replacement fee."
      />
      <button type="submit" className={styles.submit}>
        Send feedback
      </button>
    </form>
  );
}
