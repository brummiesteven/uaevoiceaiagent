"use client";

import Script from "next/script";
import { createElement, useEffect, useRef, useState } from "react";
import FeedbackForm from "./FeedbackForm";

/**
 * The widget is the whole call: STT, LLM turn, TTS and turn-taking happen inside
 * ElevenLabs. We only need the conversation id back, so the post-call webhook can
 * join the transcript onto whatever the caller flags afterwards.
 *
 * The widget does not document a conversation-id callback, so this listens for any
 * conversation-shaped detail on the events it does emit and falls back to a field
 * the caller can paste into. Never assume the id was captured.
 */
const CANDIDATE_EVENTS = [
  "elevenlabs-convai:call",
  "elevenlabs-convai:conversation-started",
  "convai-conversation-started",
];

function readConversationId(detail: unknown): string | null {
  if (!detail || typeof detail !== "object") return null;
  const record = detail as Record<string, unknown>;
  const candidate =
    record.conversationId ??
    record.conversation_id ??
    (record.conversation as Record<string, unknown> | undefined)?.conversationId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export default function CallPanel({
  agentId,
  serviceSlug,
  serviceName,
  helpline,
}: {
  agentId: string | null;
  serviceSlug: string;
  serviceName: string;
  helpline: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const onEvent = (event: Event) => {
      const id = readConversationId((event as CustomEvent).detail);
      if (id) setConversationId(id);
    };
    for (const name of CANDIDATE_EVENTS) node.addEventListener(name, onEvent);
    return () => {
      for (const name of CANDIDATE_EVENTS) node.removeEventListener(name, onEvent);
    };
  }, []);

  return (
    <>
      <h2 id="call-heading">Ask by voice</h2>
      {agentId ? (
        <>
          <p>
            Press the call button, then ask your question out loud — for example,{" "}
            <q>what documents do I need for the {serviceName}?</q>
          </p>
          <div ref={containerRef} aria-labelledby="call-heading">
            {/* Custom element from the embed script, so it has no JSX typing. */}
            {createElement("elevenlabs-convai", { "agent-id": agentId })}
          </div>
          <Script
            src="https://unpkg.com/@elevenlabs/convai-widget-embed"
            strategy="lazyOnload"
            async
          />
        </>
      ) : (
        <p className="notice">
          The call widget is not configured on this deployment:{" "}
          <code>NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> is not set.
          {helpline ? ` You can call the ${serviceName} helpline on ${helpline}.` : ""}
        </p>
      )}

      <FeedbackForm
        serviceSlug={serviceSlug}
        conversationId={conversationId}
        helpline={helpline}
      />
    </>
  );
}
