import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean } from './text.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'indicators.json');

/**
 * Headline figures for Dubai.
 *
 * These are published only on data.dubai's rendered pages — they are absent
 * from the /o/c/datasets API entirely. They are captured ahead of time and read
 * from disk so that (a) nothing is invented at runtime and (b) the voice path
 * never waits on a scrape. Every figure carries its source and period so the
 * agent can attribute what it says.
 */
export class Indicators {
  constructor() {
    this.list = [];
    this.profile = null;
    this.meta = null;
  }

  async load() {
    const raw = JSON.parse(await readFile(FILE, 'utf8'));
    this.list = raw.indicators || [];
    this.profile = raw.populationProfile || null;
    this.meta = { capturedAt: raw.capturedAt, sources: raw.sources };
    return this;
  }

  /** Loose match so spoken phrasing lands on the right figure. */
  find(query) {
    const q = clean(query).toLowerCase();
    if (!q) return null;
    let best = null;
    let bestScore = 0;
    for (const ind of this.list) {
      let score = 0;
      if (ind.key === q) score = 100;
      else {
        for (const alias of ind.aliases || []) {
          if (q === alias) score = Math.max(score, 60);
          else if (q.includes(alias)) score = Math.max(score, 40 + alias.length);
          else if (alias.includes(q) && q.length > 3) score = Math.max(score, 20);
        }
        if (ind.name.toLowerCase().includes(q)) score = Math.max(score, 30);
      }
      if (score > bestScore) { bestScore = score; best = ind; }
    }
    return bestScore > 0 ? best : null;
  }

  /** One spoken sentence, always attributed. */
  speak(ind) {
    const period = ind.period ? ` (${ind.period})` : '';
    const base = `${ind.name} is ${ind.display}${period}, published by ${ind.source}.`;
    return ind.note ? `${base} ${ind.note}` : base;
  }
}
