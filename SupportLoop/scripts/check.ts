import assert from "node:assert/strict";
import {
  devinReached,
  escalationAdded,
  ESCALATION_LABEL,
  isClosed,
  issueBody,
  LinearIssueState,
} from "../lib/linear";
import { CallFeedback } from "../lib/types";

/**
 * The two rules in this component that are worth breaking a build over: what counts as a
 * closed ticket, and whether a caller's report reaches whoever has to act on it. Both are
 * pure functions of data we already hold, so they need no network and no fixtures.
 *
 * Run with `npm test`.
 */

const issue = (over: Partial<LinearIssueState> = {}): LinearIssueState => ({
  identifier: "PER-1",
  title: "Caller report",
  state: "Todo",
  stateType: "unstarted",
  escalated: false,
  links: [],
  ...over,
});

// A ticket is only finished when Linear says the work is finished. Anything else — including
// a ticket flagged for an engineer — is still open, or escalations would vanish off /triage.
assert.equal(isClosed(issue({ stateType: "completed" })), true);
assert.equal(isClosed(issue({ stateType: "canceled" })), true);
assert.equal(isClosed(issue({ stateType: "started" })), false);
assert.equal(isClosed(issue({ stateType: "backlog" })), false);
assert.equal(isClosed(issue({ stateType: "unstarted", escalated: true })), false);

const feedback = (over: Partial<CallFeedback> = {}): CallFeedback => ({
  id: "row-1",
  createdAt: new Date().toISOString(),
  source: "voice",
  topic: "parking permits",
  conversationId: "conv_1",
  note: "It told me the wrong office and I drove there for nothing.",
  callerContact: null,
  transcript: null,
  transcriptReceivedAt: null,
  status: "new",
  ...over,
});

// Whoever picks up the ticket has to be able to act on it from the issue alone: what the
// caller said, how to find the call, and what to do when it cannot be resolved.
const voice = issueBody(feedback(), "https://example.com");
assert.match(voice, /I drove there for nothing/);
assert.match(voice, /conv_1/);
assert.match(voice, /parking permits/);
assert.match(voice, new RegExp(ESCALATION_LABEL));
assert.match(voice, /https:\/\/example\.com\/triage/);
assert.match(voice, /during a call/);

// A report with nothing attached must still say so plainly rather than render an empty
// section that reads as "there was no transcript" when it means "it has not arrived yet".
assert.match(voice, /Transcript not attached yet/);

// The web form is the fallback path and has to be distinguishable in the issue itself,
// because "the agent never filed this" is a different bug from "the agent filed this".
const web = issueBody(feedback({ source: "web", topic: null, conversationId: null }), null);
assert.match(web, /web form/);
assert.match(web, /Topic: not captured/);
assert.match(web, /Conversation id: `not captured`/);
assert.doesNotMatch(web, /Triage view/);

// Linear substitutes the API key's owner as assignee when it will not honour the one we
// asked for, and still reports success. So "has an assignee" must never be read as "Devin
// has it" — that is how a loop that reaches nobody ends up looking green.
const devinUser = { id: "devin-id", displayName: "devin" };
const assigneeStuck = (assignee: { id: string } | null, requested: string | null) =>
  Boolean(requested) && assignee?.id === requested;

assert.equal(assigneeStuck({ id: "adarsh-id" }, devinUser.id), false);
assert.equal(assigneeStuck(null, devinUser.id), false);
assert.equal(assigneeStuck({ id: devinUser.id }, devinUser.id), true);
assert.equal(assigneeStuck({ id: "adarsh-id" }, null), false);

// The Slack alert for a dropped ticket hangs off this, and so does the warning shown to
// whoever reported it. Either route reaching Devin counts; the issue merely existing does not.
assert.equal(devinReached({ devinAssigned: true, devinMentioned: false }), true);
assert.equal(devinReached({ devinAssigned: false, devinMentioned: true }), true);
assert.equal(devinReached({ devinAssigned: false, devinMentioned: false }), false);

// Slack is only allowed to fire when a ticket has stalled on a human. The expensive
// failure is not a missed alert, it is a channel that pings on every routine update and
// gets muted — after which the escalation alerts are missed too.
const label = { id: "label-1", name: ESCALATION_LABEL };
const other = { id: "label-2", name: "bug" };

// The label just went on: alert.
assert.equal(escalationAdded([other, label], { labelIds: ["label-2"] }), true);
assert.equal(escalationAdded([label], { labelIds: [] }), true);

// Already escalated, and this update was about something else — a state change, a comment,
// Devin renaming the issue. `updatedFrom` carries no labelIds, so it must stay quiet.
assert.equal(escalationAdded([label], {}), false);
assert.equal(escalationAdded([label], null), false);
assert.equal(escalationAdded([label], undefined), false);

// A label change that left the escalation label exactly as it was: still quiet.
assert.equal(escalationAdded([label, other], { labelIds: ["label-1"] }), false);

// No escalation label at all, however the labels moved around.
assert.equal(escalationAdded([other], { labelIds: [] }), false);
assert.equal(escalationAdded([], { labelIds: ["label-1"] }), false);

// Linear lets people rename labels by case, and the alert must not hinge on that.
assert.equal(escalationAdded([{ id: "label-1", name: "Needs-Engineer" }], { labelIds: [] }), true);

console.log("check.ts: all assertions passed");
