"use client";

import { useMemo } from "react";
import type { ServiceRecord } from "@/content/schema";
import { useVoiceCall } from "@/lib/voice/useVoiceCall";
import { HELPLINE } from "@/lib/voice/mockAnswers";
import { Orb } from "./Orb";
import { RotatingPrompts } from "./RotatingPrompts";
import styles from "./VoiceConsole.module.css";

export function VoiceConsole({ service }: { service: ServiceRecord }) {
  const call = useVoiceCall(service);

  const isBusy = call.state === "connecting" || call.state === "active";

  // The button's own label is always the action it performs (talk / stop) —
  // live status (connecting/listening/speaking) is shown separately below,
  // so pressing it doesn't require re-reading a label that just changed.
  const label = isBusy ? "Press to stop" : "Press to talk";

  // The connection can go "connected" before the agent's opening line has
  // actually arrived — without this, status jumps straight to "Listening…"
  // while the caller is still waiting to hear anything.
  const awaitingFirstMessage = isBusy && call.turns.length === 0;

  const statusText = awaitingFirstMessage
    ? "Loading…"
    : call.state === "connecting"
      ? "Connecting…"
      : call.state === "active"
        ? call.isSpeaking
          ? "Speaking…"
          : "Listening…"
        : null;

  const latestAgentTurn = [...call.turns].reverse().find((turn) => turn.speaker === "agent");

  const announcement = useMemo(() => {
    if (call.state === "error") return call.error ?? "Something went wrong with the call.";
    if (awaitingFirstMessage) return "Loading.";
    if (call.state === "connecting") return "Connecting your call.";
    if (call.state === "active") return call.isSpeaking ? "Agent is speaking." : "Listening.";
    return "Ready. Press the circle to talk.";
  }, [call.state, call.isSpeaking, call.error, awaitingFirstMessage]);

  function handleToggle() {
    if (isBusy) {
      void call.end();
    } else {
      void call.start();
    }
  }

  return (
    <section className={styles.console} aria-label={`Voice assistant for ${service.name}`}>
      {call.isMock && <p className={styles.mockBanner}>Simulated — {call.mockReason}</p>}

      <div aria-live="polite" className="visually-hidden">
        {announcement}
      </div>

      <RotatingPrompts prompts={service.exampleQuestions} />

      <div className={styles.stage}>
        <Orb
          active={call.state === "active"}
          busy={call.state === "connecting"}
          label={label}
          onToggle={handleToggle}
          disabled={call.state === "connecting"}
        />

        {statusText && (
          <p className={styles.statusText} data-loading={awaitingFirstMessage} data-speaking={call.isSpeaking}>
            {statusText}
          </p>
        )}

        {!awaitingFirstMessage && latestAgentTurn && isBusy && (
          <p className={styles.bigText}>{latestAgentTurn.text}</p>
        )}

        {call.state === "error" && (
          <div className={styles.errorBox} role="alert">
            <p>{call.error ?? "Something went wrong with the call."}</p>
            <p>Call the helpline at {HELPLINE}.</p>
          </div>
        )}
      </div>

      <div className={styles.helplineRow}>
        <a className={styles.helplineLink} href={`tel:${HELPLINE.replace(/[^\d+]/g, "")}`}>
          Talk to a person instead — {HELPLINE}
        </a>
      </div>

      {call.turns.length > 0 && (
        <div className={styles.transcript}>
          <h2 className={styles.transcriptHeading}>Conversation</h2>
          <ul className={styles.transcriptLog} aria-label="Call transcript">
            {call.turns.map((turn) => (
              <li key={turn.id} className={styles.transcriptTurn} data-speaker={turn.speaker}>
                <div className={styles.turnBubble}>
                  <span className={styles.transcriptSpeaker}>
                    {turn.speaker === "caller" ? "You" : "Agent"}
                  </span>
                  {turn.text}
                </div>
                {turn.speaker === "agent" && (
                  <div className={styles.rateRow}>
                    <button
                      type="button"
                      className={styles.rateButton}
                      data-selected={turn.feedback === "up"}
                      aria-pressed={turn.feedback === "up"}
                      aria-label="Good response"
                      onClick={() => call.rateTurn(turn.id, true)}
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      className={styles.rateButton}
                      data-selected={turn.feedback === "down"}
                      aria-pressed={turn.feedback === "down"}
                      aria-label="Bad response"
                      onClick={() => call.rateTurn(turn.id, false)}
                    >
                      👎
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
