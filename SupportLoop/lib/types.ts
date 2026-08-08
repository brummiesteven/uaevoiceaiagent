export type FeedbackStatus = "new" | "ticketed" | "resolved";

/**
 * Where the report came in from. The agent path is the one the architecture calls for —
 * the caller never leaves the call. The web form is a fallback for anyone who could not
 * finish the call, and it is the only path that exists before the agent is wired up.
 */
export type FeedbackSource = "voice" | "web";

export type TranscriptTurn = {
  role: "agent" | "user";
  message: string;
  timeInCallSecs?: number;
};

export type CallFeedback = {
  id: string;
  createdAt: string;
  source: FeedbackSource;
  /** What the caller was asking about, in the agent's words. Free text, not a slug. */
  topic: string | null;
  conversationId: string | null;
  note: string;
  callerContact: string | null;
  /** Attached later by the ElevenLabs post-call webhook, joined on conversationId. */
  transcript: TranscriptTurn[] | null;
  transcriptReceivedAt: string | null;
  status: FeedbackStatus;
};

export type Ticket = {
  id: string;
  createdAt: string;
  feedbackId: string;
  linearIssueId: string | null;
  linearIdentifier: string | null;
  linearUrl: string | null;
  assignee: string | null;
  /** Devin session opened by the Linear integration, when it reports one back. */
  devinSessionUrl: string | null;
};

export type TriageRow = CallFeedback & { ticket: Ticket | null };
