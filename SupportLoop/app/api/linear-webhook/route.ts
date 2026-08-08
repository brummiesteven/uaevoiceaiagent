import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { optionalEnv } from "@/lib/env";
import { escalationAdded, ESCALATION_LABEL } from "@/lib/linear";
import { notifySlack } from "@/lib/slack";

export const runtime = "nodejs";

/** Linear signs the raw body with the webhook secret and stamps it to stop replays. */
const TOLERANCE_MS = 60 * 1000;

function verifySignature(rawBody: string, header: string | null): string | null {
  const secret = optionalEnv("LINEAR_WEBHOOK_SECRET");
  if (!secret) return "LINEAR_WEBHOOK_SECRET is not set";
  if (!header) return "Missing Linear-Signature header";
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(header, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return "Signature mismatch";
  return null;
}

const payloadSchema = z.object({
  action: z.string(),
  type: z.string(),
  webhookTimestamp: z.number().optional(),
  data: z.object({
    identifier: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    description: z.string().nullish(),
    labels: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  }),
  updatedFrom: z.object({ labelIds: z.array(z.string()).nullish() }).nullish(),
});

/**
 * The one push notification in this component: a ticket Devin worked and could not resolve.
 *
 * /triage shows escalations, but only to whoever happens to load it. TECH-SPEC calls a
 * ticket that Devin cannot resolve and that never reaches an engineer worse than having no
 * loop at all, and a page nobody has open is exactly that. This closes it — Linear pushes
 * the moment the label lands, and Slack gets one message.
 *
 * Deliberately silent on everything else: new issues, state changes, comments, Devin's own
 * progress. Configure in Linear as an Issue webhook pointed at /api/linear-webhook.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const failure = verifySignature(rawBody, request.headers.get("linear-signature"));
  if (failure) return NextResponse.json({ error: failure }, { status: 401 });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const parsed = payloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unrecognised webhook payload" }, { status: 400 });
  }
  const payload = parsed.data;

  if (payload.webhookTimestamp && Math.abs(Date.now() - payload.webhookTimestamp) > TOLERANCE_MS) {
    return NextResponse.json({ error: "Webhook timestamp out of range" }, { status: 401 });
  }

  if (payload.type !== "Issue" || payload.action !== "update") {
    return NextResponse.json({ notified: false, reason: "not an issue update" });
  }
  if (!escalationAdded(payload.data.labels, payload.updatedFrom)) {
    return NextResponse.json({ notified: false, reason: `no ${ESCALATION_LABEL} label added` });
  }

  const notified = await notifySlack({
    text: `Escalated to you: ${payload.data.identifier ?? "a ticket"} needs a human engineer`,
    detail: callerLine(payload.data.description),
    fields: [
      { label: "Ticket", value: payload.data.identifier ?? "unknown" },
      { label: "Title", value: payload.data.title ?? "untitled" },
      { label: "Why you", value: `Devin could not resolve it and added \`${ESCALATION_LABEL}\`` },
    ],
    ...(payload.data.url ? { link: { text: "Open in Linear", url: payload.data.url } } : {}),
  });

  return NextResponse.json({ notified, identifier: payload.data.identifier });
}

/** Pull the caller's own words out of the issue body so the alert says what broke. */
function callerLine(description: string | null | undefined): string | undefined {
  const section = description?.split("## What the caller said")[1]?.split("\n\n")[0]?.trim();
  return section ? section.slice(0, 300) : undefined;
}
