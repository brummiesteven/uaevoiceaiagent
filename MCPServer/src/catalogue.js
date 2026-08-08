import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJSON, qs } from './http.js';
import { clean, localised } from './text.js';
import { CatalogueCore, normaliseDataset } from './catalogue-core.js';

/**
 * The Node flavour of the catalogue: everything in CatalogueCore, plus the bits
 * that need a network and a filesystem. The Cloudflare Worker uses the core
 * directly with a bundled snapshot, because data.dubai's firewall rejects
 * datacenter IPs.
 */

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

export class Catalogue extends CatalogueCore {
  async hydrate({ allowSnapshot = true } = {}) {
    try {
      const snapshot = await this.fetchLive();
      this.loadFrom({ ...snapshot, source: 'live' });
      await this.saveSnapshot(snapshot);
    } catch (err) {
      if (!allowSnapshot) throw err;
      console.error(`[catalogue] live hydrate failed (${err.message}); falling back to snapshot`);
      const raw = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
      this.loadFrom({ ...raw, source: 'snapshot' });
    }
    this.hydratedAt = new Date().toISOString();
    return this;
  }

  async fetchLive() {
    const [entityRows, themeRows, subthemeRows, publicationRows] = await Promise.all([
      fetchAll('issuingentities', 'id,title,title_i18n,key'),
      fetchAll('themes', 'id,title,title_i18n'),
      fetchAll('subthemes', 'id,title,title_i18n'),
      fetchAll('publications', 'id,title,title_i18n').catch(() => []),
    ]);
    const entities = entityRows.map((e) => ({
      id: e.id,
      title: clean(e.title),
      titleAr: clean(e.title_i18n?.ar_SA),
      key: clean(e.key) || null,
    }));
    const byId = new Map(entities.map((e) => [e.id, e]));

    const raw = await fetchAll('datasets', DATASET_FIELDS);
    const datasets = raw
      .map((r) => normaliseDataset(r, byId))
      // one record is classified Sensitive; it has no public data behind it
      .filter((d) => d.classification !== 'Sensitive');
    if (datasets.length === 0) throw new Error('catalogue returned zero datasets');

    return {
      savedAt: new Date().toISOString(),
      datasets,
      entities,
      themes: themeRows.map((t) => ({ id: t.id, title: clean(t.title), titleAr: clean(t.title_i18n?.ar_SA) })),
      subthemes: subthemeRows.map((t) => ({ id: t.id, title: clean(t.title), titleAr: clean(t.title_i18n?.ar_SA) })),
      publications: publicationRows.map((p) => ({ id: p.id, title: clean(p.title) })),
    };
  }

  async saveSnapshot(snapshot) {
    await mkdir(dirname(SNAPSHOT), { recursive: true });
    await writeFile(SNAPSHOT, JSON.stringify(snapshot), 'utf8');
  }
}

export { localised };
