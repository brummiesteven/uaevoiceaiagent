"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import type { ServiceRecord } from "@/content/schema";
import { createMockTransport } from "./mockTransport";
import { pickRandomIntro } from "./intros";
import type { CallState, Citation, TranscriptTurn } from "./types";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

/**
 * Decides once (at module load, from the env var) whether calls go to the
 * real ElevenLabs agent or the local mock. useConversation is mounted
 * unconditionally either way — React hooks can't be called conditionally —
 * its start/end just go unused on the mock path.
 */
export function useVoiceCall(service: ServiceRecord) {
  const isLive = Boolean(AGENT_ID);

  const [state, setState] = useState<CallState>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [volume, setVolume] = useState(0);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [hasEnded, setHasEnded] = useState(false);

  const turnSeqRef = useRef(0);
  const upsertTurn = useCallback((turn: TranscriptTurn) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turn.id);
      if (idx === -1) return [...prev, turn];
      const next = [...prev];
      next[idx] = turn;
      return next;
    });
  }, []);

  const conversation = useConversation({
    onConnect: ({ conversationId: id }) => setConversationId(id),
    onDisconnect: () => setHasEnded(true),
    onError: (message) => {
      setError(message);
      setState("error");
    },
    onMessage: ({ message, role, event_id }) => {
      turnSeqRef.current += 1;
      upsertTurn({
        id: `live-${turnSeqRef.current}`,
        speaker: role === "user" ? "caller" : "agent",
        text: message,
        final: true,
        eventId: event_id,
      });
    },
    onModeChange: ({ mode }) => setIsSpeaking(mode === "speaking"),
    onStatusChange: ({ status }) => {
      // Status is "disconnected" | "connecting" | "connected" | "disconnecting" —
      // no "error" here; onError (above) is what drives the error state.
      if (status === "connecting") setState("connecting");
      else if (status === "connected") setState("active");
      else if (status === "disconnected") setState("idle");
    },
  });

  // Live volume: the SDK exposes input/output levels as poll-only getters,
  // not a push event, so sample them while a live call is active.
  useEffect(() => {
    if (!isLive || state !== "active") return;
    const id = setInterval(() => {
      try {
        const level = isSpeaking ? conversation.getOutputVolume() : conversation.getInputVolume();
        setVolume(Number.isFinite(level) ? level : 0);
      } catch {
        // Volume getters can throw before the audio graph is ready.
      }
    }, 100);
    return () => clearInterval(id);
  }, [isLive, state, isSpeaking, conversation]);

  const [mockTransport] = useState(() =>
    createMockTransport(
      service,
      "No live agent id is configured (NEXT_PUBLIC_ELEVENLABS_AGENT_ID is unset) — this call is simulated."
    )
  );

  const start = useCallback(async () => {
    setError(null);
    setHasEnded(false);
    setTurns([]);
    setCitation(null);
    turnSeqRef.current = 0;

    if (isLive && AGENT_ID) {
      conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "webrtc",
        overrides: { agent: { firstMessage: pickRandomIntro() } },
      });
      return;
    }

    await mockTransport.start({
      onStateChange: setState,
      onSpeakingChange: setIsSpeaking,
      onVolume: setVolume,
      onTurn: upsertTurn,
      onConversationId: setConversationId,
      onError: (message) => {
        setError(message);
        setState("error");
      },
      onCitation: setCitation,
    });
  }, [isLive, conversation, mockTransport, upsertTurn]);

  const end = useCallback(async () => {
    if (isLive) {
      conversation.endSession();
      return;
    }
    await mockTransport.stop();
    setVolume(0);
    setHasEnded(true);
  }, [isLive, conversation, mockTransport]);

  useEffect(() => {
    return () => {
      if (isLive) conversation.endSession();
      else void mockTransport.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rateTurn = useCallback(
    (turnId: string, like: boolean) => {
      const turn = turns.find((t) => t.id === turnId);
      setTurns((prev) =>
        prev.map((t) => (t.id === turnId ? { ...t, feedback: like ? "up" : "down" } : t))
      );
      if (isLive && turn?.eventId !== undefined) {
        conversation.sendFeedback(like, turn.eventId);
      }
    },
    [turns, isLive, conversation]
  );

  return {
    state,
    isSpeaking,
    volume,
    turns,
    conversationId,
    error,
    citation,
    hasEnded,
    isMock: !isLive,
    mockReason: !isLive ? mockTransport.mockReason : undefined,
    start,
    end,
    rateTurn,
  };
}
