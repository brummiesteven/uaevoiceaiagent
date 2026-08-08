import { z } from "zod";

/**
 * The extraction contract. One shape, three consumers:
 * the web pages, the ElevenLabs knowledge base, and the MCP tools.
 *
 * Context.dev extracts government service pages directly into this shape
 * (scripts/scrape.ts). Changing it changes all three consumers.
 */

export const documentSchema = z.object({
  name: z.string(),
  notes: z.string().optional(),
  required: z.boolean().default(true),
});

export const eligibilityCriterionSchema = z.object({
  /** Stable key the MCP `check_eligibility` tool matches against. */
  id: z.string(),
  question: z.string(),
  /** Plain-language statement of what qualifies. */
  requirement: z.string(),
});

export const feeSchema = z.object({
  label: z.string(),
  amountAed: z.number().nullable(),
  notes: z.string().optional(),
});

export const serviceSchema = z.object({
  slug: z.string(),
  name: z.string(),
  authority: z.string(),
  /** One line, spoken aloud by the agent when listing matches. */
  summary: z.string(),
  audience: z.array(z.string()).default([]),
  /** Prose that goes into the ElevenLabs knowledge base for RAG. */
  description: z.string(),
  eligibility: z.array(eligibilityCriterionSchema).default([]),
  requiredDocuments: z.array(documentSchema).default([]),
  fees: z.array(feeSchema).default([]),
  processingTime: z.string().optional(),
  channels: z.array(z.string()).default([]),
  helpline: z.string().optional(),
  languages: z.array(z.string()).default(["English"]),
  source: z.object({
    url: z.string(),
    /** ISO 8601. Stale content is a known risk — see TECH-SPEC section 6. */
    scrapedAt: z.string(),
    /** False until a human has checked the extraction against the page. */
    humanVerified: z.boolean().default(false),
  }),
});

export type Service = z.infer<typeof serviceSchema>;
export type ServiceDocument = z.infer<typeof documentSchema>;
export type EligibilityCriterion = z.infer<typeof eligibilityCriterionSchema>;

export const servicesSchema = z.array(serviceSchema);

/** The knowledge base document format. Prose only — structured lookups go through MCP. */
export function toKnowledgeBaseDocument(service: Service): {
  name: string;
  text: string;
} {
  const lines = [
    `# ${service.name} (${service.authority})`,
    "",
    service.summary,
    "",
    service.description,
    "",
    "## Who it is for",
    ...service.audience.map((a) => `- ${a}`),
    "",
    "## Eligibility",
    ...service.eligibility.map((e) => `- ${e.question} ${e.requirement}`),
    "",
    "## Required documents",
    ...service.requiredDocuments.map(
      (d) =>
        `- ${d.name}${d.required ? "" : " (optional)"}${d.notes ? ` — ${d.notes}` : ""}`,
    ),
    "",
    "## Fees",
    ...service.fees.map(
      (f) =>
        `- ${f.label}: ${f.amountAed === null ? "not published" : `AED ${f.amountAed}`}${
          f.notes ? ` — ${f.notes}` : ""
        }`,
    ),
    "",
    `## Processing time`,
    service.processingTime ?? "Not published on the source page.",
    "",
    "## How to apply",
    ...service.channels.map((c) => `- ${c}`),
    "",
    `Helpline: ${service.helpline ?? "not published"}`,
    `Source: ${service.source.url}`,
    `Scraped: ${service.source.scrapedAt}`,
  ];
  return { name: `${service.slug}.md`, text: lines.join("\n") };
}
