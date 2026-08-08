export type CallState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type TranscriptTurn = {
  id: string;
  speaker: "caller" | "agent";
  text: string;
  final: boolean;
};

export type Citation = {
  publisher: string;
  section: string;
  url: string;
  checkedOn: string;
};

export type VoiceTransportEvents = {
  onStateChange(state: CallState): void;
  onVolume(level: number): void; // 0–1, drives the amplitude ring
  onTurn(turn: TranscriptTurn): void; // re-emitted as text arrives; upserted by id
  onConversationId(id: string): void; // what the feedback form reports against
  onError(message: string): void;
  /**
   * Not in the original transport sketch — added so the SourceCard can render
   * a citation the moment an answer completes, without the console having to
   * re-derive it from transcript text.
   */
  onCitation(citation: Citation): void;
};

export type VoiceTransport = {
  isMock: boolean;
  mockReason?: string;
  start(events: VoiceTransportEvents): Promise<void>;
  stop(): Promise<void>;
  interrupt(): void;
  repeatLast(opts?: { slower?: boolean }): void;
  ask(question: string): void; // suggestion chips and keyboard users
};
