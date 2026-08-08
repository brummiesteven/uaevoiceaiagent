import { linearConfigured, optionalEnv } from "./env";
import { CallFeedback, TranscriptTurn } from "./types";

const LINEAR_API = "https://api.linear.app/graphql";

export type LinearIssue = {
  id: string;
  identifier: string;
  url: string;
  assignee: string | null;
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
 */
async function findDevinAssigneeId(): Promise<string | null> {
  const override = optionalEnv("LINEAR_DEVIN_USER_ID");
  if (override) return override;
  const data = await linearRequest<{ users: { nodes: { id: string; displayName: string }[] } }>(
    `query { users(filter: { displayName: { containsIgnoreCase: "devin" } }, first: 5) {
        nodes { id displayName }
      } }`,
    {},
  );
  return data.users.nodes[0]?.id ?? null;
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
    "A caller flagged an answer from the voice agent as wrong or unhelpful.",
    "",
    "## Caller's note",
    feedback.note,
    "",
    `- Service: \`${feedback.serviceSlug ?? "unknown"}\``,
    `- Conversation id: \`${feedback.conversationId ?? "not captured"}\``,
    `- Feedback row: \`${feedback.id}\``,
    feedback.callerContact ? `- Caller contact: ${feedback.callerContact}` : null,
    appUrl ? `- Triage view: ${appUrl}/triage` : null,
    "",
    "## Transcript",
    renderTranscript(feedback.transcript),
    "",
    "## Scope for the fix",
    "Change one of these two files only:",
    "",
    "- `agent-config/prompt.md` — the answer was a behaviour problem (guessed instead of",
    "  refusing, missing citation, wrong handoff).",
    "- `content/services/<slug>.json` — the answer was a content problem (the scraped",
    "  facts are wrong, missing or stale). Re-run `npm run scrape -- <slug>` where possible.",
    "",
    "Do not change application code. Merging the PR runs `scripts/sync-agent.ts`, which",
    "pushes the prompt and knowledge base to the live agent.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export type LinearIssueState = {
  identifier: string;
  title: string;
  /** Workflow state name as configured on the team — "Todo", "In Progress", "Done". */
  state: string;
  /** Links Devin attaches to the issue as it works: the branch, then the pull request. */
  links: { title: string; url: string }[];
};

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
          state: { name: string } | null;
          attachments: { nodes: { title: string | null; url: string }[] };
        }[];
      };
    }>(
      `query IssueStates($ids: [ID!]) {
          issues(filter: { id: { in: $ids } }, first: 100) {
            nodes {
              id identifier title
              state { name }
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
  const assigneeId = await findDevinAssigneeId();
  const title = `Voice agent gave a bad answer${
    feedback.serviceSlug ? ` — ${feedback.serviceSlug}` : ""
  }`;
  const data = await linearRequest<{
    issueCreate: {
      success: boolean;
      issue: {
        id: string;
        identifier: string;
        url: string;
        assignee: { displayName: string } | null;
      } | null;
    };
  }>(
    `mutation CreateIssue($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url assignee { displayName } }
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
  };
}
