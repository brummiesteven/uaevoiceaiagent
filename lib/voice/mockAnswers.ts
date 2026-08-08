import type { ServiceRecord } from "@/content/schema";
import type { Citation } from "./types";

export type MockAnswer = {
  text: string;
  citation?: Citation;
};

export const HELPLINE = "800-555-0142 (placeholder helpline)";

function citationFor(service: ServiceRecord, section: string): Citation {
  return {
    publisher: service.publisher,
    section,
    url: service.sourceUrl,
    checkedOn: service.lastScrapedAt,
  };
}

/**
 * Keyword routing over the service record — documents, eligibility, fees,
 * processing time. Deliberately the same shape the MCP tools are specced to
 * return. Refuses and hands off to the helpline when nothing matches, rather
 * than guessing.
 */
export function answerQuestion(service: ServiceRecord, question: string): MockAnswer {
  const q = question.toLowerCase();

  if (/document|paper|bring|id\b|passport|photo/.test(q)) {
    return {
      text: `For the ${service.name}, you'll need: ${service.documentsRequired.join(", ")}.`,
      citation: citationFor(service, "Documents you need"),
    };
  }

  if (/qualif|eligib|who can|am i able|allowed|can i/.test(q)) {
    return {
      text: `You qualify for the ${service.name} if ${service.whoQualifies
        .map((w) => w.charAt(0).toLowerCase() + w.slice(1))
        .join(", or if ")}.`,
      citation: citationFor(service, "Who qualifies"),
    };
  }

  if (/fee|cost|price|how much|pay|charge/.test(q)) {
    const feeText = service.fees.map((f) => `${f.item} is ${f.amount}`).join(", and ");
    return {
      text: `Here's what it costs: ${feeText}.`,
      citation: citationFor(service, "What it costs"),
    };
  }

  if (/how long|processing|wait|when will|turnaround/.test(q)) {
    return {
      text: `Processing usually takes ${service.processingTime}.`,
      citation: citationFor(service, "How to apply"),
    };
  }

  if (/apply|how do i|steps|process|get (a|the|one)/.test(q)) {
    return {
      text: `To apply: ${service.howToApply.join(". Then, ")}.`,
      citation: citationFor(service, "How to apply"),
    };
  }

  return {
    text: `I don't have a confirmed answer for that from the ${service.publisher} record. Let's get you to a person — call the helpline at ${HELPLINE}.`,
  };
}
