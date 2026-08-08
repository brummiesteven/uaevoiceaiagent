import { randomUUID } from "node:crypto";
import { getSupabase } from "./supabase";
import { CallFeedback, FeedbackSource, Ticket, TranscriptTurn, TriageRow } from "./types";

/**
 * Supabase is the store. When it is not configured the same API falls back to
 * process memory so the report path and /triage still work locally — the
 * fallback is per-process and is lost on restart.
 */

type FeedbackRow = {
  id: string;
  created_at: string;
  source: FeedbackSource;
  topic: string | null;
  conversation_id: string | null;
  note: string;
  caller_contact: string | null;
  transcript: TranscriptTurn[] | null;
  transcript_received_at: string | null;
  status: CallFeedback["status"];
};

type TicketRow = {
  id: string;
  created_at: string;
  feedback_id: string;
  linear_issue_id: string | null;
  linear_identifier: string | null;
  linear_url: string | null;
  assignee: string | null;
  devin_session_url: string | null;
};

type Memory = { feedback: FeedbackRow[]; tickets: TicketRow[] };

/**
 * On globalThis, not a module constant: each route gets its own module instance in
 * the dev server, so a module-level array would give the webhook and the ticket route
 * separate stores and the transcript join would silently never match.
 */
const memory: Memory = ((globalThis as { __feedbackMemory?: Memory }).__feedbackMemory ??= {
  feedback: [],
  tickets: [],
});

export function storeBackend(): "supabase" | "memory" {
  return getSupabase() ? "supabase" : "memory";
}

const toFeedback = (r: FeedbackRow): CallFeedback => ({
  id: r.id,
  createdAt: r.created_at,
  source: r.source,
  topic: r.topic,
  conversationId: r.conversation_id,
  note: r.note,
  callerContact: r.caller_contact,
  transcript: r.transcript,
  transcriptReceivedAt: r.transcript_received_at,
  status: r.status,
});

const toTicket = (r: TicketRow): Ticket => ({
  id: r.id,
  createdAt: r.created_at,
  feedbackId: r.feedback_id,
  linearIssueId: r.linear_issue_id,
  linearIdentifier: r.linear_identifier,
  linearUrl: r.linear_url,
  assignee: r.assignee,
  devinSessionUrl: r.devin_session_url,
});

export async function insertFeedback(input: {
  source: FeedbackSource;
  topic: string | null;
  conversationId: string | null;
  note: string;
  callerContact: string | null;
}): Promise<CallFeedback> {
  const supabase = getSupabase();
  const row: FeedbackRow = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    source: input.source,
    topic: input.topic,
    conversation_id: input.conversationId,
    note: input.note,
    caller_contact: input.callerContact,
    transcript: null,
    transcript_received_at: null,
    status: "new",
  };
  if (!supabase) {
    memory.feedback.unshift(row);
    return toFeedback(row);
  }
  const { data, error } = await supabase
    .from("call_feedback")
    .insert({
      source: row.source,
      topic: row.topic,
      conversation_id: row.conversation_id,
      note: row.note,
      caller_contact: row.caller_contact,
    })
    .select()
    .single();
  if (error) throw new Error(`Supabase insert into call_feedback failed: ${error.message}`);
  return toFeedback(data as FeedbackRow);
}

/** Called by the post-call webhook. Attaches to every row with this conversation id. */
export async function attachTranscript(
  conversationId: string,
  transcript: TranscriptTurn[],
): Promise<number> {
  const supabase = getSupabase();
  const receivedAt = new Date().toISOString();
  if (!supabase) {
    const matches = memory.feedback.filter((f) => f.conversation_id === conversationId);
    for (const m of matches) {
      m.transcript = transcript;
      m.transcript_received_at = receivedAt;
    }
    return matches.length;
  }
  const { data, error } = await supabase
    .from("call_feedback")
    .update({ transcript, transcript_received_at: receivedAt })
    .eq("conversation_id", conversationId)
    .select("id");
  if (error) throw new Error(`Supabase update of call_feedback failed: ${error.message}`);
  return data?.length ?? 0;
}

export async function insertTicket(input: {
  feedbackId: string;
  linearIssueId: string | null;
  linearIdentifier: string | null;
  linearUrl: string | null;
  assignee: string | null;
}): Promise<Ticket> {
  const supabase = getSupabase();
  const row: TicketRow = {
    id: randomUUID(),
    created_at: new Date().toISOString(),
    feedback_id: input.feedbackId,
    linear_issue_id: input.linearIssueId,
    linear_identifier: input.linearIdentifier,
    linear_url: input.linearUrl,
    assignee: input.assignee,
    devin_session_url: null,
  };
  if (!supabase) {
    memory.tickets.unshift(row);
    const feedback = memory.feedback.find((f) => f.id === input.feedbackId);
    if (feedback) feedback.status = "ticketed";
    return toTicket(row);
  }
  const { data, error } = await supabase
    .from("tickets")
    .insert({
      feedback_id: row.feedback_id,
      linear_issue_id: row.linear_issue_id,
      linear_identifier: row.linear_identifier,
      linear_url: row.linear_url,
      assignee: row.assignee,
    })
    .select()
    .single();
  if (error) throw new Error(`Supabase insert into tickets failed: ${error.message}`);
  await supabase.from("call_feedback").update({ status: "ticketed" }).eq("id", input.feedbackId);
  return toTicket(data as TicketRow);
}

/**
 * Marks reports whose Linear issue has closed. Called by /triage after it reads Linear,
 * so the stored status follows Linear rather than trying to lead it — Linear is where a
 * human or Devin actually closes the work.
 */
export async function markResolved(feedbackIds: string[]): Promise<void> {
  if (feedbackIds.length === 0) return;
  const supabase = getSupabase();
  if (!supabase) {
    for (const f of memory.feedback) if (feedbackIds.includes(f.id)) f.status = "resolved";
    return;
  }
  await supabase
    .from("call_feedback")
    .update({ status: "resolved" })
    .in("id", feedbackIds)
    .neq("status", "resolved");
}

export async function listTriage(limit = 50): Promise<TriageRow[]> {
  const supabase = getSupabase();
  if (!supabase) {
    return memory.feedback.slice(0, limit).map((f) => ({
      ...toFeedback(f),
      ticket: memory.tickets.filter((t) => t.feedback_id === f.id).map(toTicket)[0] ?? null,
    }));
  }
  const { data: feedback, error } = await supabase
    .from("call_feedback")
    .select()
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase select from call_feedback failed: ${error.message}`);
  const rows = (feedback ?? []) as FeedbackRow[];
  const { data: tickets } = await supabase
    .from("tickets")
    .select()
    .in(
      "feedback_id",
      rows.map((r) => r.id),
    );
  const ticketRows = (tickets ?? []) as TicketRow[];
  return rows.map((f) => ({
    ...toFeedback(f),
    ticket: ticketRows.filter((t) => t.feedback_id === f.id).map(toTicket)[0] ?? null,
  }));
}
