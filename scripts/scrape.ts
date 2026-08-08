/**
 * Context.dev crawl + structured extraction into content/schema.ts.
 *
 *   npm run scrape                 all services in content/sources.ts
 *   npm run scrape -- sanad-card   one service, after its government page changes
 *
 * Extraction is against our own JSON Schema rather than markdown conversion: five
 * pages with five layouts have to come back in one shape, because the web pages, the
 * knowledge base and the MCP tools all read that shape.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { serviceSources } from "../content/sources";
import { serviceSchema } from "../content/schema";

const EXTRACT_URL = process.env.CONTEXT_API_URL ?? "https://api.context.dev/v1/web/extract";
const OUT_DIR = path.join(process.cwd(), "content", "services");

/** slug and source provenance are ours, not the page's. */
const extractionSchema = serviceSchema.omit({ slug: true, source: true });

function jsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(extractionSchema, { io: "input", target: "draft-7" });
  return schema as Record<string, unknown>;
}

async function extract(url: string, instructions: string, maxPages: number) {
  const apiKey = process.env.CONTEXT_DEV_API_KEY;
  if (!apiKey) throw new Error("CONTEXT_DEV_API_KEY is not set");

  const response = await fetch(EXTRACT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      schema: jsonSchema(),
      instructions,
      maxPages,
      // Entitlement facts are the whole product; an inferred fee is worse than a gap.
      factCheck: true,
      timeoutMS: 110000,
    }),
  });

  const body = (await response.json()) as {
    data?: Record<string, unknown>;
    urls_analyzed?: string[];
    message?: string;
  };
  if (!response.ok) {
    throw new Error(`Context.dev extract failed (${response.status}): ${body.message ?? "no message"}`);
  }
  if (!body.data) throw new Error("Context.dev returned no data");
  return { data: body.data, urlsAnalyzed: body.urls_analyzed ?? [] };
}

async function main() {
  const wanted = process.argv.slice(2);
  const targets = wanted.length
    ? serviceSources.filter((s) => wanted.includes(s.slug))
    : serviceSources;

  if (targets.length === 0) {
    throw new Error(
      `No matching service. Known slugs: ${serviceSources.map((s) => s.slug).join(", ")}`,
    );
  }

  for (const source of targets) {
    process.stdout.write(`Extracting ${source.slug} from ${source.url}\n`);
    const { data, urlsAnalyzed } = await extract(
      source.url,
      source.instructions,
      source.maxPages ?? 5,
    );

    const parsed = serviceSchema.safeParse({
      ...data,
      slug: source.slug,
      source: {
        url: urlsAnalyzed[0] ?? source.url,
        scrapedAt: new Date().toISOString(),
        // Set to true by hand, in the PR, once someone has read the page.
        humanVerified: false,
      },
    });

    if (!parsed.success) {
      process.stderr.write(
        `${source.slug} did not match content/schema.ts — not written:\n${JSON.stringify(
          parsed.error.issues,
          null,
          2,
        )}\n`,
      );
      process.exitCode = 1;
      continue;
    }

    const file = path.join(OUT_DIR, `${source.slug}.json`);
    fs.writeFileSync(file, `${JSON.stringify(parsed.data, null, 2)}\n`);
    process.stdout.write(`  wrote ${path.relative(process.cwd(), file)} from ${urlsAnalyzed.length} pages\n`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
