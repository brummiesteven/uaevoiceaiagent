import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { agentSecretConfigured, optionalEnv } from "@/lib/env";
import { fileReport } from "@/lib/report";

export const runtime = "nodejs";

/**
 * The webhook tool the ElevenLabs agent calls when a caller is unhappy or wants to report
 * an issue — mid-call or as the call wraps up.
 *
 * Deliberately not an MCP tool. MCP answers the caller's question from the data source
 * under a latency budget; this files a complaint. Keeping them apart is what makes
 * "the data source had nothing" distinguishable from "the agent failed this caller".
 *
 * Register in ElevenLabs → Agents → Tools → Webhook. Contract in SupportLoop/README.md.
 */

const bodySchema = z.object({
  /** What the caller said is wrong, in their words as the agent heard them. */
  note: z.string().trim().min(3).max(2000),
  /** What the call was about — free text from the agent, not a fixed vocabulary. */
  topic: z.string().trim().max(200).nullish(),
  /** ElevenLabs conversation id, so the post-call webhook can attach the transcript. */
  conversation_id: z.string().trim().max(200).nullish(),
  caller_contact: z.string().trim().max(200).nullish(),
});

/**
 * Constant-time compare so a wrong secret cannot be recovered by timing the response.
 * Length is compared first because timingSafeEqual throws on a length mismatch.
 */
function secretMatches(presented: string | null): boolean {
  const expected = optionalEnv("SUPPORT_AGENT_SECRET");
  if (!expected || !presented) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(presented);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  // An open endpoint here means anyone can flood the team's Linear board, so this refuses
  // to run unsecured in production rather than degrading like the other integrations.
  if (!agentSecretConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "SUPPORT_AGENT_SECRET is not set — refusing unauthenticated tickets" },
        { status: 500 },
      );
    }
  } else if (!secretMatches(request.headers.get("x-support-secret"))) {
    return NextResponse.json({ error: "Bad or missing x-support-secret" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  const result = await fileReport({
    source: "voice",
    note: parsed.data.note,
    topic: parsed.data.topic ?? null,
    conversationId: parsed.data.conversation_id ?? null,
    callerContact: parsed.data.caller_contact ?? null,
  });

  // `spoken_response` is what the agent reads out. The model echoes tool output closely,
  // so handing it a finished sentence is more reliable than handing it fields to narrate —
  // and a caller must never hear a ticket id read out as a raw UUID.
  return NextResponse.json({
    filed: true,
    reference: result.ticket?.identifier ?? null,
    spoken_response: result.ticket
      ? `Your report has been logged as ${spellForSpeech(result.ticket.identifier)}. Someone will pick it up.`
      : "Your report has been saved and someone will pick it up.",
    ...(result.warning ? { warning: result.warning } : {}),
  });
}

/**
 * "PER-12" spoken as-is comes out as "per twelve". Spacing the letters and the number
 * makes TTS read it as a reference a caller can write down and quote back.
 */
function spellForSpeech(identifier: string): string {
  const [prefix, number] = identifier.split("-");
  if (!number) return identifier;
  return `${prefix.split("").join(" ")} ${number.split("").join(" ")}`;
}
