import { clean } from './text.js';


/**
 * Practical information about actually living in Dubai — utility tariffs and the
 * entitlements available to People of Determination.
 *
 * None of this is in the open data catalogue: it lives on DEWA, RTA and Parkin
 * pages and was captured with context.dev. Held on disk rather than fetched live
 * so a caller never waits on three third-party sites mid-sentence, and so the
 * figures can't drift under us during a conversation.
 *
 * Everything carries its provider, source URL and capture date. Entitlements and
 * tariffs change, and telling someone they get free parking when they don't is a
 * real harm — so the tools attach a "confirm with them" note rather than
 * presenting this as the last word.
 */
export class LivingInfo {
  constructor() {
    this.utilities = null;
    this.services = [];
    this.capturedAt = null;
    this.capturedAtSpoken = null;
    this.disclaimer = null;
  }


  /** Hydrate from an already-loaded object (used by the Worker). */
  loadFrom(raw) {
    this.utilities = raw.utilities;
    this.services = raw.accessibility || [];
    this.capturedAt = raw.capturedAt;
    this.capturedAtSpoken = raw.capturedAtSpoken || raw.capturedAt;
    this.disclaimer = raw.disclaimer;
    return this;
  }

  /** Loose alias match, same approach as the indicator lookup. */
  findService(query) {
    const q = clean(query).toLowerCase();
    if (!q) return null;
    let best = null;
    let bestScore = 0;
    for (const s of this.services) {
      let score = 0;
      if (s.key === q || s.topic === q) score = 100;
      for (const alias of s.aliases || []) {
        if (q === alias) score = Math.max(score, 70);
        else if (q.includes(alias)) score = Math.max(score, 40 + alias.length);
        else if (alias.includes(q) && q.length > 3) score = Math.max(score, 25);
      }
      if (s.headline.toLowerCase().includes(q)) score = Math.max(score, 30);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    return bestScore > 0 ? best : null;
  }

  /** Everything matching a topic, so "parking" returns both permits. */
  byTopic(topic) {
    const t = clean(topic).toLowerCase();
    return this.services.filter((s) => s.topic === t);
  }

  /**
   * Cost of a month's consumption under the slab tariff.
   *
   * DEWA slabs are marginal, not flat: crossing into a higher band charges the
   * higher rate only on the units above the threshold. Charging the top rate on
   * the whole bill would overstate it by a wide margin.
   */
  estimateUtility(kind, amount) {
    const table = this.utilities?.[kind];
    if (!table || !(amount > 0)) return null;
    let remaining = amount;
    let cost = 0;
    const bands = [];
    for (const slab of table.slabs) {
      if (remaining <= 0) break;
      const lower = slab.from === 0 ? 0 : slab.from - 1;
      const upper = slab.to ?? Infinity;
      const width = upper - lower;
      const used = Math.min(remaining, width);
      if (used > 0) {
        cost += used * slab.rate;
        bands.push({ units: Math.round(used), rate: slab.rate });
        remaining -= used;
      }
    }
    const surcharge = amount * (table.fuelSurcharge?.rate || 0);
    return {
      kind,
      amount,
      unit: table.unit,
      spokenUnit: table.spokenUnit || table.unit,
      slabCost: Number(cost.toFixed(2)),
      fuelSurcharge: Number(surcharge.toFixed(2)),
      total: Number((cost + surcharge).toFixed(2)),
      bands,
      provider: this.utilities.provider,
      sourceUrl: table === this.utilities.electricity
        ? this.utilities.sourceUrl
        : this.utilities.sourceUrl,
    };
  }
}
