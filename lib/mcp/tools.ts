import { getService, getServices, searchServices } from "@/content";

/**
 * Structured lookups only. Prose lives in the ElevenLabs knowledge base and is
 * retrieved by its RAG — duplicating it here would just make the payloads slower.
 * Every tool answers from committed JSON with no network call, so responses are
 * a few milliseconds and small: a slow tool stalls the agent mid-sentence.
 */

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown;
};

const answerValues = ["yes", "no", "unsure"] as const;
type Answer = (typeof answerValues)[number];

function normaliseAnswer(value: unknown): Answer {
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (["yes", "y", "true", "have", "i do"].includes(text)) return "yes";
  if (["no", "n", "false", "none", "i don't", "i do not"].includes(text)) return "no";
  return "unsure";
}

export const tools: ToolDefinition[] = [
  {
    name: "find_service",
    description:
      "Find UAE government services matching what the caller described. Returns service slugs with a one-line summary and the source URL. Call this first when the caller has not named a service exactly.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What the caller said, in their own words.",
        },
      },
      required: ["query"],
    },
    handler: (args) => {
      const matches = searchServices(String(args.query ?? ""));
      return {
        matches: matches.slice(0, 5).map((s) => ({
          service_id: s.slug,
          name: s.name,
          authority: s.authority,
          summary: s.summary,
          source_url: s.source.url,
        })),
        available_services: getServices().map((s) => s.slug),
      };
    },
  },
  {
    name: "get_required_documents",
    description:
      "Return the document checklist for one service. Use the service_id returned by find_service.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service slug, e.g. sanad-card." },
      },
      required: ["service_id"],
    },
    handler: (args) => {
      const service = getService(String(args.service_id ?? ""));
      if (!service) {
        return {
          error: "unknown_service",
          available_services: getServices().map((s) => s.slug),
        };
      }
      return {
        service_id: service.slug,
        required: service.requiredDocuments.filter((d) => d.required).map((d) => d.name),
        conditional: service.requiredDocuments
          .filter((d) => !d.required)
          .map((d) => ({ name: d.name, when: d.notes ?? null })),
        source_url: service.source.url,
      };
    },
  },
  {
    name: "check_eligibility",
    description:
      "Check a caller against the published eligibility criteria for a service. Pass the caller's answers keyed by criterion id; omit any you have not asked yet. Never state a final eligibility decision the caller did not answer for — this tool returns needs_human_review when anything is unanswered.",
    inputSchema: {
      type: "object",
      properties: {
        service_id: { type: "string", description: "Service slug, e.g. sanad-card." },
        criteria: {
          type: "object",
          description:
            'Caller answers keyed by criterion id, each "yes", "no" or "unsure", e.g. {"residency":"yes"}.',
          additionalProperties: { type: "string", enum: [...answerValues] },
        },
      },
      required: ["service_id"],
    },
    handler: (args) => {
      const service = getService(String(args.service_id ?? ""));
      if (!service) {
        return { error: "unknown_service", available_services: getServices().map((s) => s.slug) };
      }
      const submitted = (args.criteria ?? {}) as Record<string, unknown>;
      const criteria = service.eligibility.map((criterion) => ({
        id: criterion.id,
        requirement: criterion.requirement,
        answer: criterion.id in submitted ? normaliseAnswer(submitted[criterion.id]) : null,
        /** The exact question to read out when the answer is still missing. */
        ask: criterion.question,
      }));
      const unanswered = criteria.filter((c) => c.answer === null || c.answer === "unsure");
      const failing = criteria.filter((c) => c.answer === "no");

      const verdict =
        failing.length > 0
          ? "does_not_qualify"
          : unanswered.length > 0
            ? "needs_human_review"
            : "qualifies";

      return {
        service_id: service.slug,
        verdict,
        unmet: failing.map((c) => c.requirement),
        still_needed: unanswered.map((c) => ({ id: c.id, ask: c.ask })),
        helpline: service.helpline ?? null,
        source_url: service.source.url,
      };
    },
  },
];
