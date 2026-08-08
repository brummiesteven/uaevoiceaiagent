"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ServiceRecord } from "@/content/schema";
import { resolveTransport } from "./index";
import type { CallState, Citation, TranscriptTurn } from "./types";

export function useVoiceCall(service: ServiceRecord) {
  const [transport] = useState(() => resolveTransport("live", service));
  const transportRef = useRef(transport);

  const [state, setState] = useState<CallState>("idle");
  const [volume, setVolume] = useState(0);
  const [turns, setTurns] = useState<TranscriptTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [citation, setCitation] = useState<Citation | null>(null);
  const [hasEnded, setHasEnded] = useState(false);

  const upsertTurn = useCallback((turn: TranscriptTurn) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === turn.id);
      if (idx === -1) return [...prev, turn];
      const next = [...prev];
      next[idx] = turn;
      return next;
    });
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setHasEnded(false);
    setTurns([]);
    setCitation(null);
    await transportRef.current.start({
      onStateChange: setState,
      onVolume: setVolume,
      onTurn: upsertTurn,
      onConversationId: setConversationId,
      onError: (message) => {
        setError(message);
        setState("error");
      },
      onCitation: setCitation,
    });
  }, [upsertTurn]);

  const end = useCallback(async () => {
    await transportRef.current.stop();
    setVolume(0);
    setHasEnded(true);
  }, []);

  useEffect(() => {
    return () => {
      void transportRef.current.stop();
    };
  }, []);

  return {
    state,
    volume,
    turns,
    conversationId,
    error,
    citation,
    hasEnded,
    isMock: transportRef.current.isMock,
    mockReason: transportRef.current.mockReason,
    start,
    end,
    interrupt: () => transportRef.current.interrupt(),
    repeatLast: (opts?: { slower?: boolean }) => transportRef.current.repeatLast(opts),
    ask: (question: string) => transportRef.current.ask(question),
  };
}
