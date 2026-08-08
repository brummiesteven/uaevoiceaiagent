"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { useCallback, useState } from "react";
import FeedbackForm from "./FeedbackForm";

/**
 * The call itself runs inside ElevenLabs: STT, the LLM turn, TTS and turn-taking.
 * We use the React SDK rather than the <elevenlabs-convai> embed for two reasons the
 * architecture depends on:
 *
 *   1. onConnect hands us the conversation id. That id is the join key between a
 *      caller's feedback row and the transcript the post-call webhook delivers later.
 *      The embed does not expose it, so the repair loop would be guessing.
 *   2. onMessage gives us every turn as it happens, which is what the live transcript
 *      is built from. A voice-only interface excludes deaf and hard-of-hearing callers —
 *      on a People of Determination service that is not an optional extra.
 */

type Turn = { role: "agent" | "user"; message: string };

type Props = {
  agentId: string | null;
  serviceSlug: string;
  serviceName: string;
  helpline: string | null;
};

function CallSession({ agentId, serviceSlug, serviceName, helpline }: Props & { agentId: string }) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const conversation = useConversation({
    onConnect: ({ conversationId: id }) => setConversationId(id),
    onMessage: ({ message, role }) => {
      const text = message.trim();
      if (text) setTurns((previous) => [...previous, { role, message: text }]);
    },
    onError: (message: string) => setError(message || "The call ended unexpectedly."),
  });

  const start = useCallback(async () => {
    setError(null);
    setTurns([]);
    try {
      // Ask for the microphone before connecting, so a denied permission reads as a
      // permission problem rather than a failed call.
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({ agentId, connectionType: "webrtc" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not start the call: ${caught.message}`
          : "Could not start the call.",
      );
    }
  }, [agentId, conversation]);

  const status = conversation.status;
  const live = status === "connected";

  return (
    <>
      <section aria-labelledby="call-heading">
        <p>
          Start the call, then ask your question out loud — for example,{" "}
          <q>what documents do I need for the {serviceName}?</q> Everything said is written out
          below as it happens.
        </p>

        <button
          type="button"
          onClick={live ? () => conversation.endSession() : start}
          disabled={status === "connecting"}
        >
          {live ? "End the call" : status === "connecting" ? "Connecting…" : "Start the call"}
        </button>

        {/* Status in words, not colour or animation alone. */}
        <p className="status" role="status" aria-live="polite">
          {status === "connecting" && "Connecting to the agent…"}
          {live && (conversation.isSpeaking ? "The agent is speaking." : "Listening to you.")}
          {status === "disconnected" &&
            (turns.length > 0 ? "The call has ended." : "Not connected.")}
        </p>

        {error && (
          <p className="status" data-kind="error" role="alert">
            {error}
            {helpline ? ` You can call ${helpline} instead.` : ""}
          </p>
        )}

        <h3 id="transcript-heading">Live transcript</h3>
        {/* role="log" so a screen reader announces new turns without moving focus.
            It stays on the page after the call, so the caller can read back the answer
            they are about to report as wrong. */}
        <div
          className="transcript"
          role="log"
          aria-live="polite"
          aria-labelledby="transcript-heading"
        >
          {turns.length === 0 ? (
            <p>Nothing said yet.</p>
          ) : (
            turns.map((turn, index) => (
              <p className="transcript-turn" key={index}>
                <b>{turn.role === "agent" ? "Agent" : "You"}</b>
                {turn.message}
              </p>
            ))
          )}
        </div>
      </section>

      <FeedbackForm
        serviceSlug={serviceSlug}
        conversationId={conversationId}
        helpline={helpline}
      />
    </>
  );
}

export default function CallPanel(props: Props) {
  const { agentId, serviceSlug, serviceName, helpline } = props;
  return (
    <>
      <h2 id="call-heading">Ask by voice</h2>
      {agentId ? (
        // useConversation reads its state off this provider.
        <ConversationProvider>
          <CallSession {...props} agentId={agentId} />
        </ConversationProvider>
      ) : (
        <>
          <p className="notice">
            The call is not configured on this deployment:{" "}
            <code>NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> is not set.
            {helpline ? ` You can call the ${serviceName} helpline on ${helpline}.` : ""}
          </p>
          <FeedbackForm serviceSlug={serviceSlug} conversationId={null} helpline={helpline} />
        </>
      )}
    </>
  );
}
