/**
 * The pages `npm run scrape` extracts from. One entry per service; the slug is the
 * filename in content/services and the id every MCP tool uses.
 *
 * `instructions` steers Context.dev's crawl — these pages link out to PDFs and to
 * the authority's own portal, and the useful facts are usually one hop in.
 */
export type ServiceSource = {
  slug: string;
  url: string;
  instructions: string;
  maxPages?: number;
};

export const serviceSources: ServiceSource[] = [
  {
    slug: "sanad-card",
    url: "https://u.ae/en/information-and-services/social-affairs/people-of-determination",
    instructions:
      "Extract the Sanad Card issued by Dubai's Community Development Authority for people of determination: who can apply, the documents required, fees, processing time, how to apply and the helpline. Follow links to the Community Development Authority service page.",
    maxPages: 8,
  },
  {
    slug: "people-of-determination-card",
    url: "https://u.ae/en/information-and-services/social-affairs/people-of-determination",
    instructions:
      "Extract the federal People of Determination Card issued by the Ministry of Community Development: eligibility, required documents, fees, how to apply and the helpline.",
    maxPages: 8,
  },
  {
    slug: "parking-permit-people-of-determination",
    url: "https://u.ae/en/information-and-services/transportation/driving-in-the-uae",
    instructions:
      "Extract the parking permit for people of determination in Dubai issued by the Roads and Transport Authority: eligibility, required documents, fees, validity and how to apply.",
    maxPages: 8,
  },
];
