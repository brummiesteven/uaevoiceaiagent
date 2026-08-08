export type CallState = "idle" | "connecting" | "active" | "error";

export type TranscriptTurn = {
  id: string;
  speaker: "caller" | "agent";
  text: string;
  final: boolean;
  /** Live calls only — needed to attach thumbs up/down via sendFeedback. */
  eventId?: number;
  feedback?: "up" | "down";
};

export type Citation = {
  publisher: string;
  section: string;
  url: string;
  checkedOn: string;
};

export type VoiceTransportEvents = {
  onStateChange(state: CallState): void;
  onSpeakingChange(isSpeaking: boolean): void;
  onVolume(level: number): void; // 0–1, drives the amplitude ring
  onTurn(turn: TranscriptTurn): void; // re-emitted as text arrives; upserted by id
  onConversationId(id: string): void; // what the feedback form reports against
  onError(message: string): void;
  /**
   * Not available from a live call (the agent cites its source in speech,
   * per prompt.md, rather than as structured data) — only the mock
   * transport ever calls this, to demo the SourceCard.
   */
  onCitation(citation: Citation): void;
};

/**
 * Only the mock transport implements this shape directly. The live path
 * can't: @elevenlabs/react's useConversation is a React hook (must be
 * called unconditionally at the top of a component), not a factory that
 * can hand back a plain start/stop object — see useVoiceCall.ts, which
 * mounts useConversation directly and switches between it and this mock
 * transport based on whether an agent id is configured.
 */
export type VoiceTransport = {
  isMock: boolean;
  mockReason?: string;
  start(events: VoiceTransportEvents): void | Promise<void>;
  stop(): void | Promise<void>;
};
