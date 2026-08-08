"use client";

import { useMemo, useState } from "react";
import type { ServiceRecord } from "@/content/schema";
import { useVoiceCall } from "@/lib/voice/useVoiceCall";
import { HELPLINE } from "@/lib/voice/mockAnswers";
import { Orb } from "./Orb";
import { RotatingPrompts } from "./RotatingPrompts";
import styles from "./VoiceConsole.module.css";

export function VoiceConsole({ service }: { service: ServiceRecord }) {
  const call = useVoiceCall(service);
  const [holding, setHolding] = useState(false);

  const isBusy = call.state === "connecting" || call.state === "active";

  const label =
    call.state === "connecting"
      ? "Connecting…"
      : call.state === "active"
        ? call.isSpeaking
          ? "Speaking…"
          : "Listening…"
        : "Hold to talk";

  const announcement = useMemo(() => {
    if (call.state === "error") return call.error ?? "Something went wrong with the call.";
    if (call.state === "connecting") return "Connecting your call.";
    if (call.state === "active") return call.isSpeaking ? "Agent is speaking." : "Listening.";
    return "Ready. Press and hold the circle to talk.";
  }, [call.state, call.isSpeaking, call.error]);

  function beginHold() {
    if (holding || isBusy) return;
    setHolding(true);
    void call.start();
  }

  function endHold() {
    if (!holding) return;
    setHolding(false);
    void call.end();
  }

  return (
    <section className={styles.console} aria-label={`Voice assistant for ${service.name}`}>
      {call.isMock && <p className={styles.mockBanner}>Simulated — {call.mockReason}</p>}

      <div aria-live="polite" className="visually-hidden">
        {announcement}
      </div>

      <RotatingPrompts prompts={service.exampleQuestions} />

      <div className={styles.stage}>
        <div className={styles.orbWrap}>
          <Orb active={call.state === "active"} />
          <button
            type="button"
            className={styles.holdButton}
            data-active={isBusy}
            onPointerDown={(e) => {
              e.preventDefault();
              beginHold();
            }}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                beginHold();
              }
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                endHold();
              }
            }}
            disabled={call.state === "connecting"}
          >
            {label}
          </button>
        </div>

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
