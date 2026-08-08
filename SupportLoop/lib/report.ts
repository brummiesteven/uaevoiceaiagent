import { linearConfigured } from "./env";
import { createIssueForFeedback, devinReached, LinearIssue } from "./linear";
import { notifySlack } from "./slack";
import { insertFeedback, insertTicket } from "./store";
import { FeedbackSource } from "./types";

export type ReportInput = {
  source: FeedbackSource;
  note: string;
  topic: string | null;
  conversationId: string | null;
  callerContact: string | null;
};

export type ReportResult = {
  feedbackId: string;
  ticket: { identifier: string; url: string; assignee: string | null } | null;
  /** Set when the report was stored but did not become a Linear issue. */
  warning: string | null;
};

/**
 * The one path from "a caller said something went wrong" to "a ticket exists", shared by
 * the agent webhook and the web form.
 *
 * The row is written first and returned even when Linear fails. A caller who took the
 * trouble to report something has already spent their patience; losing the report to an
 * integration outage is the one failure this loop exists to prevent, and an un-ticketed
 * row is still visible on /triage and still recoverable.
 */
export async function fileReport(input: ReportInput): Promise<ReportResult> {
  const feedback = await insertFeedback({
    source: input.source,
    note: input.note,
    topic: input.topic,
    conversationId: input.conversationId,
    callerContact: input.callerContact,
  });

  if (!linearConfigured()) {
    return {
      feedbackId: feedback.id,
      ticket: null,
      warning: "Linear is not configured, so no ticket was opened. The report was saved.",
    };
  }

  try {
    const issue = await createIssueForFeedback(feedback, appUrl());
    await insertTicket({
      feedbackId: feedback.id,
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearUrl: issue.url,
      assignee: issue.assignee,
    });
    // Only when the handoff failed. A ticket Devin picked up is working as designed and
    // does not interrupt anyone; see lib/slack.ts for why that restraint is the point.
    if (!devinReached(issue)) {
      await notifySlack({
        text: `Devin did not pick up ${issue.identifier} — nothing is working on it`,
        detail: input.note.slice(0, 300),
        fields: [
          { label: "Ticket", value: issue.identifier },
          { label: "Came in via", value: input.source === "voice" ? "the agent, mid-call" : "web form" },
          { label: "Why you", value: "Devin was not reached, so this ticket has no first responder" },
        ],
        link: { text: "Open in Linear", url: issue.url },
      });
    }

    return {
      feedbackId: feedback.id,
      ticket: { identifier: issue.identifier, url: issue.url, assignee: issue.assignee },
      warning: devinWarning(issue),
    };
  } catch (error) {
    return {
      feedbackId: feedback.id,
      ticket: null,
      warning: `The report was saved but Linear rejected it: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

/**
 * Says exactly how far the Devin handoff got, because "a ticket exists" and "something is
 * going to work on it" are different claims and only the second one closes the loop.
 */
export function devinWarning(issue: LinearIssue): string | null {
  if (issue.devinAssigned) return null;
  if (issue.devinMentioned) {
    return "Linear would not assign this to the Devin app user, so Devin was mentioned in a comment instead.";
  }
  return "Devin was not reached: it is not in this Linear workspace, or the mention failed.";
}

function appUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  return configured ? configured.replace(/\/$/, "") : null;
}
