import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJSON, qs } from './http.js';
import { clean, stripHtml, localised } from './text.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAPSHOT = join(ROOT, 'data', 'catalogue-snapshot.json');
const BASE = 'https://data.dubai/o/c';
const PAGE_SIZE = 200;

// Kept deliberately narrow. Requesting every field returns ~26KB per record and
// most of it is empty contact/metadata boilerplate.
const DATASET_FIELDS = [
  'id', 'title', 'title_i18n', 'description', 'description_i18n',
  'themes', 'themes_i18n', 'category', 'isStatistics', 'classification',
  'viewCount', 'downloadCount', 'frequencyOfUpdateToSDP', 'frequencyOfUpdateOnSource',
  'dataAPIEndpointsRawText', 'r_issuingEntityOfDataset_c_issuingEntityId',
  'ingestionDate', 'publishedDate', 'dateModified', 'license', 'language',
  'datasetSource', 'format', 'rights', 'unitOfMeasure', 'referencePeriod',
  'timeCoverage', 'aboutThisDataSetRawText',
].join(',');

// data.dubai is slow and intermittently drops requests — a 200-record page can
// take 30s+. An early version used a 20s timeout and swallowed failures, which
// silently produced a 399-dataset catalogue out of 599 and looked like success.
// Pages are now retried, and a short page is reported loudly rather than
// quietly accepted.
const PAGE_TIMEOUT_MS = 60000;
const RETRIES = 3;

async function fetchPage(object, fields, page) {
  const url = `${BASE}/${object}?${qs({ page, pageSize: PAGE_SIZE, fields })}`;
  let lastErr;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      return await getJSON(url, { timeoutMs: PAGE_TIMEOUT_MS });
    } catch (err) {
      lastErr = err;
      console.error(`[catalogue] ${object} page ${page} attempt ${attempt}/${RETRIES} failed: ${err.message}`);
      if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
  throw new Error(`${object} page ${page} failed after ${RETRIES} attempts: ${lastErr.message}`);
}

async function fetchAll(object, fields) {
  const first = await fetchPage(object, fields, 1);
  const total = first.totalCount ?? (first.items || []).length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => fetchPage(object, fields, i + 2).then((d) => d.items || [])),
  );
  const items = [...(first.items || []), ...rest.flat()];
  if (items.length < total) {
    throw new Error(`${object}: got ${items.length} of ${total} records — refusing a partial catalogue`);
  }
  return items;
}

const splitList = (s) =>
  clean(s).split(',').map((x) => x.trim()).filter(Boolean);

function normaliseDataset(raw, entityById) {
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
function indexDataset(d) {
  return [d.title, d.description, d.themes.join(' '), d.categories.join(' '), d.entity, d.source]
    .filter(Boolean).join(' ').toLowerCase();
}

export class Catalogue {
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

  async hydrate({ allowSnapshot = true } = {}) {
    try {
      await this.#loadLive();
      this.source = 'live';
      await this.#saveSnapshot();
    } catch (err) {
      if (!allowSnapshot) throw err;
      console.error(`[catalogue] live hydrate failed (${err.message}); falling back to snapshot`);
      await this.#loadSnapshot();
      this.source = 'snapshot';
    }
    this.#buildIndex();
    this.hydratedAt = new Date().toISOString();
    return this;
  }

  async #loadLive() {
    const [entities, themes, subthemes, publications] = await Promise.all([
      fetchAll('issuingentities', 'id,title,title_i18n,key'),
      fetchAll('themes', 'id,title,title_i18n'),
      fetchAll('subthemes', 'id,title,title_i18n'),
      fetchAll('publications', 'id,title,title_i18n').catch(() => []),
    ]);
    this.entities = entities.map((e) => ({
      id: e.id,
      title: clean(e.title),
      titleAr: clean(e.title_i18n?.ar_SA),
      key: clean(e.key) || null,
    }));
    const byId = new Map(this.entities.map((e) => [e.id, e]));
    this.themes = themes.map((t) => ({ id: t.id, title: clean(t.title), titleAr: clean(t.title_i18n?.ar_SA) }));
    this.subthemes = subthemes.map((t) => ({ id: t.id, title: clean(t.title), titleAr: clean(t.title_i18n?.ar_SA) }));
    this.publications = publications.map((p) => ({ id: p.id, title: clean(p.title) }));

    const raw = await fetchAll('datasets', DATASET_FIELDS);
    this.datasets = raw
      .map((r) => normaliseDataset(r, byId))
      // one record is classified Sensitive; it has no public data behind it
      .filter((d) => d.classification !== 'Sensitive');
    if (this.datasets.length === 0) throw new Error('catalogue returned zero datasets');
  }

  async #saveSnapshot() {
    const payload = {
      savedAt: new Date().toISOString(),
      datasets: this.datasets,
      entities: this.entities,
      themes: this.themes,
      subthemes: this.subthemes,
      publications: this.publications,
    };
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(payload), 'utf8');
  }

  async #loadSnapshot() {
    const raw = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
    Object.assign(this, {
      datasets: raw.datasets || [],
      entities: raw.entities || [],
      themes: raw.themes || [],
      subthemes: raw.subthemes || [],
      publications: raw.publications || [],
    });
  }

  #buildIndex() {
    this._haystack = new Map(this.datasets.map((d) => [d.id, indexDataset(d)]));
    this._byId = new Map(this.datasets.map((d) => [d.id, d]));
  }

  get(id) {
    return this._byId.get(Number(id)) || null;
  }

  /**
   * Local ranked search.
   *
   * Ranking is done here rather than delegated to the portal's own `search`
   * param for two reasons: it is instant against an in-memory array, and the
   * portal's relevance is poor (searching "housing" there returns
   * "Real Estate Offices" first). Scoring rewards title hits over body hits and
   * requires every term to appear somewhere, which is what makes multi-word
   * voice queries behave.
   */
  search(query, { theme, entity, updateFrequency, statisticsOnly, withApiOnly, limit = 5 } = {}) {
    const terms = clean(query).toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    let pool = this.datasets;

    if (theme) {
      const t = theme.toLowerCase();
      pool = pool.filter((d) => d.themes.some((x) => x.toLowerCase().includes(t)));
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
      const title = d.title.toLowerCase();
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
      score += Math.min(Math.log10(d.views + 1) * 2, 6);
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

export { localised };
