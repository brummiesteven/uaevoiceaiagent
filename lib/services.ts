import fs from "node:fs";
import path from "node:path";
import type { ServiceRecord } from "@/content/schema";

const SERVICES_DIR = path.join(process.cwd(), "content", "services");

let cache: ServiceRecord[] | null = null;

export function getAllServices(): ServiceRecord[] {
  if (cache) return cache;
  const files = fs.readdirSync(SERVICES_DIR).filter((f) => f.endsWith(".json"));
  cache = files
    .map((file) => {
      const raw = fs.readFileSync(path.join(SERVICES_DIR, file), "utf-8");
      return JSON.parse(raw) as ServiceRecord;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return cache;
}

export function getService(slug: string): ServiceRecord | undefined {
  return getAllServices().find((service) => service.slug === slug);
}
