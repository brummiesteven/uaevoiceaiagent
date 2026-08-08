import { optionalEnv } from "./env";

/**
 * Slack is the escalation channel, not a feed.
 *
 * Exactly two things are worth interrupting a person for, and neither of them is "a ticket
 * was created" — tickets are what /triage is for, and a channel that pings on every caller
 * report gets muted within a day, which costs us the two alerts that actually matter:
 *
 *   1. Devin never picked the ticket up, so nothing is working on it.
 *   2. Devin worked it, could not resolve it, and flagged it for a human engineer.
 *
 * Both mean the loop has stalled on a person. Everything else is noise.
 */

export type SlackAlert = {
  /** Fallback text — this is what shows in the notification and on mobile. */
  text: string;
  /** The line under the heading, e.g. what the caller actually said. */
  detail?: string;
  fields?: { label: string; value: string }[];
  link?: { text: string; url: string };
};

export const slackConfigured = () => Boolean(optionalEnv("SLACK_WEBHOOK_URL"));

/**
 * Never throws and never blocks the caller's result. A Slack outage must not turn a
 * successfully filed ticket into a failed request — the ticket is the durable record, the
 * ping is only how it gets noticed sooner.
 */
export async function notifySlack(alert: SlackAlert): Promise<boolean> {
  const url = optionalEnv("SLACK_WEBHOOK_URL");
  if (!url) return false;

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${alert.text}*` } },
  ];
  if (alert.detail) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `> ${alert.detail}` } });
  }
  if (alert.fields?.length) {
    blocks.push({
      type: "section",
      fields: alert.fields.map((f) => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` })),
    });
  }
  if (alert.link) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `<${alert.link.url}|${alert.link.text}>` }],
    });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: alert.text, blocks }),
    });
    if (!response.ok) {
      process.stderr.write(`Slack rejected the alert: ${response.status}\n`);
      return false;
    }
    return true;
  } catch (error) {
    process.stderr.write(
      `Could not reach Slack: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return false;
  }
}
