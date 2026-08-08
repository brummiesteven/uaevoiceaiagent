import { linearConfigured, optionalEnv } from "./env";
import { CallFeedback, TranscriptTurn } from "./types";

const LINEAR_API = "https://api.linear.app/graphql";

/**
 * The escalation contract, in one constant.
 *
 * Devin is the first responder on every ticket. When it cannot resolve one it adds this
 * label, and that is the whole signal — no extra service, no polling job, no state of our
 * own to keep in sync. A human can add it by hand for the same effect. TECH-SPEC calls a
 * ticket that Devin cannot resolve and that never reaches an engineer worse than no loop
 * at all, so this is the one thing /triage sorts to the top and counts.
 */
export const ESCALATION_LABEL = "needs-engineer";

export type LinearIssue = {
  id: string;
  identifier: string;
  url: string;
  assignee: string | null;
  /**
   * Whether the issue really ended up assigned to Devin. Read back from the created
   * issue, never inferred from `assignee !== null` — Linear substitutes the API key's
   * owner, so an issue nobody handed to Devin still comes back with a name on it.
   */
  devinAssigned: boolean;
  /** Whether the @devin comment that triggers a session was posted. */
  devinMentioned: boolean;
};

async function linearRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: optionalEnv("LINEAR_API_KEY")!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) {
    throw new Error(
      `Linear API error: ${body.errors?.map((e) => e.message).join("; ") ?? response.status}`,
    );
  }
  return body.data as T;
}

/**
 * The Linear→Devin handoff is an assignment: with the Devin integration installed,
 * assigning an issue to the Devin user starts a session. No glue code here.
 *
 * Returns null when Devin is not in the workspace, and the caller still files the ticket —
 * an unassigned ticket a human can see beats a dropped report.
 */
export async function findDevinUserId(): Promise<string | null> {
  const override = optionalEnv("LINEAR_DEVIN_USER_ID");
  if (override) return override;
  if (!linearConfigured()) return null;
  try {
    const data = await linearRequest<{ users: { nodes: { id: string; displayName: string }[] } }>(
      `query { users(filter: { displayName: { containsIgnoreCase: "devin" } }, first: 5) {
          nodes { id displayName }
        } }`,
      {},
    );
    return data.users.nodes[0]?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Wakes Devin up on an issue.
 *
 * Assignment alone is not enough and cannot be trusted: Linear accepts `assigneeId`
 * pointing at the Devin OAuth app user, returns `success: true`, and then leaves the
 * issue assigned to whoever owns the API key. Verified against this workspace — both
 * `issueCreate` and a follow-up `issueUpdate` reported success and changed nothing.
 * A comment that mentions Devin is the trigger that does survive the API, so both are
 * attempted and the caller is told which one actually took.
 */
async function mentionDevin(issueId: string): Promise<boolean> {
  try {
    const data = await linearRequest<{ commentCreate: { success: boolean } }>(
      `mutation Mention($input: CommentCreateInput!) {
          commentCreate(input: $input) { success }
        }`,
      {
        input: {
          issueId,
          body: "@devin please pick this up — details and scope are in the description above.",
        },
      },
    );
    return data.commentCreate.success;
  } catch {
    return false;
  }
}

function renderTranscript(transcript: TranscriptTurn[] | null): string {
  if (!transcript?.length) {
    return "_Transcript not attached yet — the post-call webhook writes it to the same row._";
  }
  return transcript
    .map((t) => `**${t.role === "agent" ? "Agent" : "Caller"}:** ${t.message}`)
    .join("\n\n");
}

export function issueBody(feedback: CallFeedback, appUrl: string | null): string {
  return [
    feedback.source === "voice"
      ? "A caller raised this with the voice agent during a call. The agent took it down and filed it."
      : "Someone reported this through the web form.",
    "",
    "## What the caller said",
    feedback.note,
    "",
    `- Topic: ${feedback.topic ? `\`${feedback.topic}\`` : "not captured"}`,
    `- Conversation id: \`${feedback.conversationId ?? "not captured"}\``,
    `- Report row: \`${feedback.id}\``,
    feedback.callerContact ? `- Caller contact: ${feedback.callerContact}` : null,
    appUrl ? `- Triage view: ${appUrl}/triage` : null,
    "",
    "## Transcript",
    renderTranscript(feedback.transcript),
    "",
    "## What to do with this",
    "Devin is the first responder. Work the ticket as far as it goes, then either close it",
    `or add the \`${ESCALATION_LABEL}\` label so a human engineer picks it up. Do not leave it`,
    "open and unlabelled — a ticket nobody owns looks handled and isn't.",
    "",
    "Bear in mind which component this actually belongs to before changing anything:",
    "",
    "- The answer was wrong or the agent guessed → the agent prompt (`ElevenLabsAgent/`).",
    "- The data was wrong, missing or stale → the MCP server and its sources (`MCPServer/`).",
    "- The report itself did not reach anyone → this support loop (`SupportLoop/`).",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export type LinearIssueState = {
  identifier: string;
  title: string;
  /** Workflow state name as configured on the team — "Todo", "In Progress", "Done". */
  state: string;
  /** Linear's state category, which is stable across teams that rename their states. */
  stateType: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled" | string;
  /** Devin (or a human) could not resolve this and flagged it for an engineer. */
  escalated: boolean;
  /** Links Devin attaches to the issue as it works: the branch, then the pull request. */
  links: { title: string; url: string }[];
};

export const isClosed = (issue: LinearIssueState) =>
  issue.stateType === "completed" || issue.stateType === "canceled";

/**
 * Reads the current state of issues we already created, for /triage.
 *
 * The point is that a Linear workspace is private. Anyone reviewing this project — or any
 * member of the public looking at the deployed triage page — cannot open `linearUrl`, so a
 * bare link is the one place the evidence trail dead-ends. The server holds the API key and
 * the reader does not, so read the state here and print it. The attachments carry the pull
 * request URL, which is public, and that is where the trail picks up again.
 *
 * Never throws: a Linear outage or a missing key degrades /triage to the stored identifier
 * rather than taking the page down.
 */
export async function fetchIssueStates(ids: string[]): Promise<Map<string, LinearIssueState>> {
  const found = new Map<string, LinearIssueState>();
  if (!linearConfigured() || ids.length === 0) return found;
  try {
    const data = await linearRequest<{
      issues: {
        nodes: {
          id: string;
          identifier: string;
          title: string;
          state: { name: string; type: string } | null;
          labels: { nodes: { name: string }[] };
          attachments: { nodes: { title: string | null; url: string }[] };
        }[];
      };
    }>(
      `query IssueStates($ids: [ID!]) {
          issues(filter: { id: { in: $ids } }, first: 100) {
            nodes {
              id identifier title
              state { name type }
              labels(first: 20) { nodes { name } }
              attachments(first: 10) { nodes { title url } }
            }
          }
        }`,
      { ids },
    );
    for (const issue of data.issues.nodes) {
      found.set(issue.id, {
        identifier: issue.identifier,
        title: issue.title,
        state: issue.state?.name ?? "Unknown",
        stateType: issue.state?.type ?? "unknown",
        escalated: issue.labels.nodes.some(
          (label) => label.name.toLowerCase() === ESCALATION_LABEL,
        ),
        links: issue.attachments.nodes.map((a) => ({ title: a.title ?? a.url, url: a.url })),
      });
    }
  } catch (error) {
    process.stderr.write(
      `Could not read Linear issue states: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return found;
}

export async function createIssueForFeedback(
  feedback: CallFeedback,
  appUrl: string | null,
): Promise<LinearIssue> {
  if (!linearConfigured()) throw new Error("Linear is not configured");
  const assigneeId = await findDevinUserId();
  const title = `Caller report${feedback.topic ? ` — ${feedback.topic}` : ""}`;
  const data = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: {
        id: string;
        identifier: string;
        url: string;
        assignee: { id: string; displayName: string } | null;
      } | null;
    };
  }>(
    `mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url assignee { id displayName } }
        }
      }`,
    {
      input: {
        teamId: optionalEnv("LINEAR_TEAM_ID"),
        title,
        description: issueBody(feedback, appUrl),
        ...(assigneeId ? { assigneeId } : {}),
      },
    },
  );
  const issue = data.issueCreate.issue;
  if (!data.issueCreate.success || !issue) throw new Error("Linear issueCreate returned no issue");
  return {
    id: issue.id,
    identifier: issue.identifier,
    url: issue.url,
    assignee: issue.assignee?.displayName ?? null,
    devinAssigned: Boolean(assigneeId) && issue.assignee?.id === assigneeId,
    devinMentioned: assigneeId ? await mentionDevin(issue.id) : false,
  };
}
