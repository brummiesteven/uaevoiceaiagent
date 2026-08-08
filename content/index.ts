import fs from "node:fs";
import path from "node:path";
import { Service, serviceSchema } from "./schema";

const SERVICES_DIR = path.join(process.cwd(), "content", "services");

let cache: Service[] | null = null;

/** Reads and validates every scraped service. Server-side only. */
export function getServices(): Service[] {
  if (cache) return cache;
  const files = fs
    .readdirSync(SERVICES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort();
  cache = files.map((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(SERVICES_DIR, file), "utf8"));
    const parsed = serviceSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(
        `content/services/${file} does not match content/schema.ts:\n${JSON.stringify(
          parsed.error.issues,
          null,
          2,
        )}`,
      );
    }
    return parsed.data;
  });
  return cache;
}

export function getService(slug: string): Service | undefined {
  return getServices().find((s) => s.slug === slug);
}

/** Substring match over the fields a caller is likely to say out loud. */
export function searchServices(query: string): Service[] {
  const q = query.trim().toLowerCase();
  if (!q) return getServices();
  const terms = q.split(/\s+/).filter((t) => t.length > 2);
  return getServices().filter((s) => {
    const haystack = [s.name, s.slug, s.summary, s.authority, ...s.audience]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q) || terms.some((t) => haystack.includes(t));
  });
}
