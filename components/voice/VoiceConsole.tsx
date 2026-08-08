"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { ServiceRecord } from "@/content/schema";
import { useVoiceCall } from "@/lib/voice/useVoiceCall";
import { HELPLINE } from "@/lib/voice/mockAnswers";
import { AmplitudeRing } from "./AmplitudeRing";
import { SourceCard } from "./SourceCard";
import { FeedbackForm } from "./FeedbackForm";
import styles from "./VoiceConsole.module.css";

const STATE_LABEL: Record<string, string> = {
  idle: "Tap to talk",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Answering…",
  error: "Call error",
};

export function VoiceConsole({ service }: { service: ServiceRecord }) {
  const call = useVoiceCall(service);
  const [question, setQuestion] = useState("");

  const lastCallerTurn = useMemo(
    () => [...call.turns].reverse().find((turn) => turn.speaker === "caller"),
    [call.turns]
  );
  const lastAgentTurn = useMemo(
    () => [...call.turns].reverse().find((turn) => turn.speaker === "agent"),
    [call.turns]
  );

  const announcement = useMemo(() => {
    if (call.state === "thinking") {
      return `Looking that up in the ${service.publisher} records.`;
    }
    if (call.state === "error") {
      return call.error ?? "Something went wrong with the call.";
    }
    return STATE_LABEL[call.state];
  }, [call.state, call.error, service.publisher]);

  async function ensureStartedThenAsk(text: string) {
    if (call.state === "idle") {
      await call.start();
    }
    call.ask(text);
  }

  function handleMicTap() {
    if (call.state === "idle") {
      void call.start();
    }
  }

  function handleAskSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    setQuestion("");
    void ensureStartedThenAsk(trimmed);
  }

  const callActive = call.state !== "idle" && call.state !== "error";
  const showAskControls = call.state === "idle" || call.state === "listening";

  return (
    <section className={styles.console} aria-label={`Voice assistant for ${service.name}`}>
      {call.isMock && (
        <p className={styles.mockBanner}>
          Simulated call — {call.mockReason ?? "no live voice agent is connected yet."}
        </p>
      )}

      <div aria-live="polite" className="visually-hidden">
        {announcement}
      </div>

      <div className={styles.stage}>
        <div className={styles.micWrap}>
          <AmplitudeRing volume={call.volume} active={call.state === "listening"} />
          <button
            type="button"
            className={styles.micButton}
            onClick={handleMicTap}
            disabled={call.state !== "idle"}
            aria-pressed={callActive}
          >
            {STATE_LABEL[call.state]}
          </button>
        </div>

        {call.state === "idle" && (
          <div className={styles.suggestions}>
            <p className={styles.suggestionsLabel}>Try asking:</p>
            <div className={styles.chipRow}>
              {service.exampleQuestions.map((exampleQuestion) => (
                <button
                  key={exampleQuestion}
                  type="button"
                  className={styles.chip}
                  onClick={() => void ensureStartedThenAsk(exampleQuestion)}
                >
                  {exampleQuestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {call.state === "listening" && lastCallerTurn && (
          <p className={styles.bigText}>{lastCallerTurn.text}</p>
        )}

        {call.state === "thinking" && (
          <p className={styles.thinkingText}>
            Looking that up in the {service.publisher} records…
          </p>
        )}

        {call.state === "speaking" && lastAgentTurn && (
          <p className={styles.bigText}>{lastAgentTurn.text}</p>
        )}

        {call.state === "error" && (
          <div className={styles.errorBox} role="alert">
            <p>{call.error ?? "Something went wrong with the call."}</p>
            <p>Call the helpline at {HELPLINE}.</p>
          </div>
        )}

        {call.citation && (call.state === "speaking" || call.state === "listening") && (
          <SourceCard citation={call.citation} />
        )}

        {showAskControls && (
          <form className={styles.askForm} onSubmit={handleAskSubmit}>
            <label htmlFor="ask-question" className={styles.askLabel}>
              Type a question instead of speaking
            </label>
            <input
              id="ask-question"
              type="text"
              className={styles.askInput}
              placeholder="Type your question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button type="submit" className={styles.askSubmit}>
              Ask
            </button>
          </form>
        )}
      </div>

      {callActive && (
        <div className={styles.controlsRow}>
          <button type="button" className={styles.controlButton} onClick={() => call.repeatLast()}>
            Say it again
          </button>
          <button
            type="button"
            className={styles.controlButton}
            onClick={() => call.repeatLast({ slower: true })}
          >
            Say it slower
          </button>
          <button type="button" className={styles.controlButton} onClick={() => call.interrupt()}>
            Stop talking
          </button>
          <button
            type="button"
            className={styles.controlButton}
            data-danger="true"
            onClick={() => void call.end()}
          >
            End the call
          </button>
        </div>
      )}

      <div className={styles.helplineRow}>
        <a className={styles.helplineLink} href={`tel:${HELPLINE.replace(/[^\d+]/g, "")}`}>
          Talk to a person instead — {HELPLINE}
        </a>
      </div>

      {call.turns.length > 0 && (
        <div className={styles.transcript}>
          <h2>Conversation so far</h2>
          <ul className={styles.transcriptLog} aria-label="Call transcript">
            {call.turns.map((turn) => (
              <li key={turn.id} className={styles.transcriptTurn} data-speaker={turn.speaker}>
                <span className={styles.transcriptSpeaker}>
                  {turn.speaker === "caller" ? "You" : "Agent"}
                </span>
                {turn.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.hasEnded && (
        <div className={styles.postCall}>
          <FeedbackForm
            conversationId={call.conversationId}
            serviceSlug={service.slug}
            isMock={call.isMock}
          />
        </div>
      )}
    </section>
  );
}
