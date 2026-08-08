import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fileReport } from "@/lib/report";
import { storeBackend } from "@/lib/store";

export const runtime = "nodejs";

/**
 * The web fallback for the same loop the agent uses. It exists for a caller who could not
 * finish the call, and for anyone reviewing the project who has no phone number to ring.
 * Unauthenticated by design — it is a public complaint form — so it carries no secret and
 * files under source "web", which keeps it distinguishable on /triage.
 */

const bodySchema = z.object({
  note: z.string().trim().min(3, "Tell us what went wrong").max(2000),
  topic: z.string().trim().max(200).nullish(),
  conversationId: z.string().trim().max(200).nullish(),
  callerContact: z.string().trim().max(200).nullish(),
});

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

  const result = await fileReport({
    source: "web",
    note: parsed.data.note,
    topic: parsed.data.topic ?? null,
    conversationId: parsed.data.conversationId ?? null,
    callerContact: parsed.data.callerContact ?? null,
  });

  return NextResponse.json({
    storedIn: storeBackend(),
    feedbackId: result.feedbackId,
    ticket: result.ticket,
    ...(result.warning ? { warning: result.warning } : {}),
  });
}
