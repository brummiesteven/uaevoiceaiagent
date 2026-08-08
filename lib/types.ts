export type FeedbackStatus = "new" | "ticketed" | "resolved";

export type TranscriptTurn = {
  role: "agent" | "user";
  message: string;
  timeInCallSecs?: number;
};

export type CallFeedback = {
  id: string;
  createdAt: string;
  serviceSlug: string | null;
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
