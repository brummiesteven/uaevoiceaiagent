import { clean, stripHtml } from './text.js';

/**
 * The catalogue, with no host dependencies.
 *
 * Shared by the Node server — which hydrates it over the network — and the
 * Cloudflare Worker, which hands it a snapshot baked into the bundle. Search
 * and ranking live here so both servers rank identically; two servers with
 * drifting relevance would be worse than either alone.
 */

export const splitList = (s) =>
  clean(s).split(',').map((x) => x.trim()).filter(Boolean);

export function normaliseDataset(raw, entityById) {
  const entityId = raw.r_issuingEntityOfDataset_c_issuingEntityId;
  const entity = entityById.get(entityId);
  const apiEndpoint = clean(raw.dataAPIEndpointsRawText);
  const description = stripHtml(raw.description || raw.aboutThisDataSetRawText || '');
  return {
    id: raw.id,
    title: clean(raw.title),
    titleAr: clean(raw.title_i18n?.ar_SA),
    description,
    descriptionAr: stripHtml(raw.description_i18n?.ar_SA || ''),
    themes: splitList(raw.themes),
    themesAr: splitList(raw.themes_i18n?.ar_SA),
    categories: splitList(raw.category),
    entityId,
    entity: entity?.title || null,
    entityAr: entity?.titleAr || null,
    entityKey: entity?.key || null,
    isStatistics: Boolean(raw.isStatistics),
    classification: raw.classification?.key || 'Unknown',
    views: Number(raw.viewCount) || 0,
    downloads: Number(raw.downloadCount) || 0,
    updateFrequency: clean(raw.frequencyOfUpdateToSDP) || null,
    sourceUpdateFrequency: clean(raw.frequencyOfUpdateOnSource) || null,
    apiEndpoint: apiEndpoint || null,
    source: clean(raw.datasetSource) || null,
    format: clean(raw.format) || null,
    license: raw.license?.name || null,
    language: raw.language?.name || null,
    unit: clean(raw.unitOfMeasure) || null,
    referencePeriod: clean(raw.referencePeriod) || null,
    timeCoverage: clean(raw.timeCoverage) || null,
    ingestedAt: raw.ingestionDate || null,
    publishedAt: raw.publishedDate || null,
    modifiedAt: raw.dateModified || null,
    url: `https://data.dubai/en/l/${raw.id}`,
  };
}

/** Pre-computed lowercase haystack so search does no work per query. */
const indexDataset = (d) =>
  [d.title, d.description, (d.themes || []).join(' '), (d.categories || []).join(' '), d.entity, d.source]
    .filter(Boolean).join(' ').toLowerCase();

export class CatalogueCore {
  constructor() {
    this.datasets = [];
    this.entities = [];
    this.themes = [];
    this.subthemes = [];
    this.publications = [];
    this.hydratedAt = null;
    this.source = 'empty';
    this._haystack = new Map();
    this._byId = new Map();
  }

  buildIndex() {
    this._haystack = new Map(this.datasets.map((d) => [d.id, indexDataset(d)]));
    this._byId = new Map(this.datasets.map((d) => [d.id, d]));
  }

  /** Hydrate from an already-loaded snapshot rather than the network. */
  loadFrom(snapshot) {
    this.datasets = snapshot.datasets || [];
    this.entities = snapshot.entities || [];
    this.themes = snapshot.themes || [];
    this.subthemes = snapshot.subthemes || [];
    this.publications = snapshot.publications || [];
    this.buildIndex();
    this.source = snapshot.source || 'bundled';
    this.hydratedAt = snapshot.savedAt || null;
    return this;
  }

  get(id) {
    return this._byId.get(Number(id)) || null;
  }

  /**
   * Local ranked search.
   *
   * Ranking happens here rather than being delegated to the portal's own
   * `search` param, for two reasons: it is instant against an in-memory array,
   * and the portal's relevance is poor — searching "housing" there returns
   * "Real Estate Offices" first. Scoring rewards title hits over body hits and
   * requires every term to appear somewhere, which is what makes multi-word
   * voice queries behave.
   */
  search(query, { theme, entity, updateFrequency, statisticsOnly, withApiOnly, limit = 5 } = {}) {
    const terms = clean(query).toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    let pool = this.datasets;

    if (theme) {
      const t = theme.toLowerCase();
      pool = pool.filter((d) => (d.themes || []).some((x) => x.toLowerCase().includes(t)));
    }
    if (entity) {
      const e = entity.toLowerCase();
      pool = pool.filter(
        (d) => d.entity?.toLowerCase().includes(e) || d.entityKey?.toLowerCase() === e,
      );
    }
    if (updateFrequency) {
      const f = updateFrequency.toLowerCase();
      pool = pool.filter((d) => d.updateFrequency?.toLowerCase() === f);
    }
    if (statisticsOnly === true) pool = pool.filter((d) => d.isStatistics);
    if (statisticsOnly === false) pool = pool.filter((d) => !d.isStatistics);
    if (withApiOnly) pool = pool.filter((d) => d.apiEndpoint);

    if (terms.length === 0) {
      const ranked = [...pool].sort((a, b) => b.views - a.views);
      return { total: ranked.length, results: ranked.slice(0, limit) };
    }

    const scored = [];
    for (const d of pool) {
      const hay = this._haystack.get(d.id) || '';
      const title = (d.title || '').toLowerCase();
      let score = 0;
      let matchedAll = true;
      for (const term of terms) {
        if (title.includes(term)) score += 10;
        else if (hay.includes(term)) score += 3;
        else matchedAll = false;
      }
      if (!matchedAll) continue;
      if (title === clean(query).toLowerCase()) score += 50;
      if (title.startsWith(terms[0])) score += 5;
      // popularity as a gentle tiebreak, capped so it can't outrank relevance
      score += Math.min(Math.log10((d.views || 0) + 1) * 2, 6);
      scored.push({ d, score });
    }
    scored.sort((a, b) => b.score - a.score || b.d.views - a.d.views);
    return { total: scored.length, results: scored.slice(0, limit).map((s) => s.d) };
  }

  stats() {
    const by = (fn) => {
      const m = new Map();
      for (const d of this.datasets) {
        const k = fn(d);
        if (Array.isArray(k)) k.forEach((x) => m.set(x, (m.get(x) || 0) + 1));
        else if (k) m.set(k, (m.get(k) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    return {
      totalDatasets: this.datasets.length,
      totalEntities: this.entities.length,
      statistics: this.datasets.filter((d) => d.isStatistics).length,
      tabular: this.datasets.filter((d) => !d.isStatistics).length,
      withApiEndpoint: this.datasets.filter((d) => d.apiEndpoint).length,
      byTheme: by((d) => d.themes),
      byEntity: by((d) => d.entity),
      byUpdateFrequency: by((d) => d.updateFrequency),
      source: this.source,
      hydratedAt: this.hydratedAt,
    };
  }
}
