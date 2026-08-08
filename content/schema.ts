/**
 * Placeholder extraction contract for the frontend mockup, until A's real
 * content/schema.ts lands from the Context.dev scrape. Field shape follows
 * TECH-SPEC.md §2's schema-field-to-page-section table.
 */

export type Fee = {
  item: string;
  amount: string;
};

export type ServiceRecord = {
  slug: string;
  name: string;
  publisher: string;
  summary: string;
  whoQualifies: string[];
  documentsRequired: string[];
  fees: Fee[];
  processingTime: string;
  howToApply: string[];
  sourceUrl: string;
  lastScrapedAt: string;
  exampleQuestions: string[];
  /** Always true until A's real scrape replaces these records. */
  fixture: true;
};
