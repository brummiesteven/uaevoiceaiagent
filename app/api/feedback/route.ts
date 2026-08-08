import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { linearConfigured, optionalEnv } from "@/lib/env";
import { createIssueForFeedback } from "@/lib/linear";
import { insertFeedback, insertTicket, storeBackend } from "@/lib/store";

export const runtime = "nodejs";

const bodySchema = z.object({
  note: z.string().trim().min(3, "Tell us what went wrong").max(2000),
  serviceSlug: z.string().trim().max(120).nullish(),
  conversationId: z.string().trim().max(200).nullish(),
  callerContact: z.string().trim().max(200).nullish(),
});

function appUrl(request: NextRequest): string | null {
  const configured = optionalEnv("NEXT_PUBLIC_APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  const host = request.headers.get("host");
  return host ? `https://${host}` : null;
}

/**
 * The entry point of the repair loop: caller's note → Supabase row → Linear issue
 * assigned to Devin. The row is written first and returned even if Linear fails,
 * so a flagged call is never lost to an integration outage.
 */
export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }

  const feedback = await insertFeedback({
    note: parsed.data.note,
    serviceSlug: parsed.data.serviceSlug ?? null,
    conversationId: parsed.data.conversationId ?? null,
    callerContact: parsed.data.callerContact ?? null,
  });

  if (!linearConfigured()) {
    return NextResponse.json({
      feedbackId: feedback.id,
      storedIn: storeBackend(),
      ticket: null,
      warning: "LINEAR_API_KEY or LINEAR_TEAM_ID is not set — no issue was opened",
    });
  }

  try {
    const issue = await createIssueForFeedback(feedback, appUrl(request));
    const ticket = await insertTicket({
      feedbackId: feedback.id,
      linearIssueId: issue.id,
      linearIdentifier: issue.identifier,
      linearUrl: issue.url,
      assignee: issue.assignee,
    });
    return NextResponse.json({
      feedbackId: feedback.id,
      storedIn: storeBackend(),
      ticket: {
        id: ticket.id,
        identifier: issue.identifier,
        url: issue.url,
        assignee: issue.assignee,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        feedbackId: feedback.id,
        storedIn: storeBackend(),
        ticket: null,
        warning: `Feedback stored, but opening the Linear issue failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      },
      { status: 502 },
    );
  }
}
