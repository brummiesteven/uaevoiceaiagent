import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { optionalEnv, webhookSecretConfigured } from "@/lib/env";
import { attachTranscript } from "@/lib/store";
import { TranscriptTurn } from "@/lib/types";

export const runtime = "nodejs";

/** ElevenLabs sends `t=<unix seconds>,v0=<hex hmac of "t.body">`. */
const TOLERANCE_SECONDS = 30 * 60;

function verifySignature(rawBody: string, header: string | null): string | null {
  const secret = optionalEnv("ELEVENLABS_WEBHOOK_SECRET");
  if (!secret) return "ELEVENLABS_WEBHOOK_SECRET is not set";
  if (!header) return "Missing ElevenLabs-Signature header";

  const parts = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parts["t"];
  const signature = parts["v0"];
  if (!timestamp || !signature) return "Malformed ElevenLabs-Signature header";

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return "Signature timestamp out of range";

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "Signature mismatch";
  return null;
}

const payloadSchema = z.object({
  type: z.string(),
  data: z.object({
    conversation_id: z.string(),
    transcript: z
      .array(
        z.object({
          role: z.string(),
          message: z.string().nullish(),
          time_in_call_secs: z.number().nullish(),
        }),
      )
      .default([]),
  }),
});

/**
 * Post-call webhook. Joins the transcript onto any feedback row carrying the same
 * conversation id — the caller flags the call before ElevenLabs finishes processing it,
 * so the two halves arrive out of order by design.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader =
    request.headers.get("elevenlabs-signature") ?? request.headers.get("ElevenLabs-Signature");

  if (webhookSecretConfigured()) {
    const failure = verifySignature(rawBody, signatureHeader);
    if (failure) return NextResponse.json({ error: failure }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "ELEVENLABS_WEBHOOK_SECRET is not set — refusing unverified webhooks" },
      { status: 500 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unrecognised webhook payload" }, { status: 400 });
  }
  if (parsed.data.type !== "post_call_transcription") {
    return NextResponse.json({ ignored: parsed.data.type });
  }

  const transcript: TranscriptTurn[] = parsed.data.data.transcript
    .filter((turn) => (turn.message ?? "").trim().length > 0)
    .map((turn) => ({
      role: turn.role === "agent" ? "agent" : "user",
      message: (turn.message ?? "").trim(),
      ...(typeof turn.time_in_call_secs === "number"
        ? { timeInCallSecs: turn.time_in_call_secs }
        : {}),
    }));

  const updated = await attachTranscript(parsed.data.data.conversation_id, transcript);
  return NextResponse.json({
    conversationId: parsed.data.data.conversation_id,
    turns: transcript.length,
    feedbackRowsUpdated: updated,
  });
}
