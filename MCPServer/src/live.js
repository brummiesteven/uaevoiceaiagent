import { request } from 'node:https';

/**
 * Live web fetch, mid-conversation, via context.dev.
 *
 * Everything else this server answers is cached at boot, because a caller
 * should never wait on a network. But some figures are genuinely live — Dubai
 * publishes a continuously-updating population counter that moves while you are
 * talking to it, and utility tariffs can be changed by the provider on any day.
 * For those, a cached answer is a stale answer, and stale is wrong.
 *
 * Two things make this necessary rather than decorative:
 *
 *  1. The figures are not in any API. They exist only on rendered pages.
 *  2. data.dubai's firewall rejects datacenter IPs outright — verified against
 *     the JSON API, not just the HTML. Requests must originate from a UAE
 *     address, which is what context.dev's `country` option provides. Without
 *     that route, this data is unreachable from a server at all.
 */

const ENDPOINT = 'https://api.context.dev/v1/web/scrape/markdown';

const SOURCES = {
  population: {
    url: 'https://data.dubai/en/population-now',
    country: 'ae',   // data.dubai rejects datacenter IPs
    label: 'live population counter',
    publisher: 'Dubai Data and Statistics Establishment',
    // The counter and its supporting figures, as rendered.
    extract: (md) => {
      const out = {};
      const total = md.match(/([\d.]+)M\s*(?:people|residents)|One number tells the story,\s*([\d.]+)M/i);
      if (total) out.population = `${total[1] || total[2]} million`;
      const arrivals = md.match(/\*\*([\d,.]+K?)\*\*\s*new residents/i);
      if (arrivals) out.newResidentsThisYear = arrivals[1];
      const daytime = md.match(/([\d.]+M)\s*Active Individuals During Daytime/i);
      if (daytime) out.daytimeActive = daytime[1];
      const commuters = md.match(/welcomes\s*\*\*([\d.]+M)\*\*\s*commuters/i);
      if (commuters) out.dailyCommuters = commuters[1];
      return out;
    },
  },
  electricity: {
    url: 'https://dewa.gov.ae/en/consumer/billing/slab-tariff',
    label: 'current DEWA electricity and water tariff',
    publisher: 'Dubai Electricity and Water Authority',
    extract: (md) => ({ raw: md.slice(0, 600) }),
  },
};

function scrape(url, apiKey, { country, timeoutMs = 55000 } = {}) {
  // GET with query params — context.dev's scrape endpoint is not a POST.
  const params = [
    ['url', url],
    ['useMainContentOnly', 'true'],
    ['waitForMs', '3000'],
    ['maxAgeMs', '0'],          // never a cached scrape; being live is the point
    ...(country ? [['country', country]] : []),
  ].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  return new Promise((resolve, reject) => {
    const req = request(
      `${ENDPOINT}?${params}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const d = JSON.parse(raw);
            if (!d.markdown) return reject(new Error(d.error || `no content (HTTP ${res.statusCode})`));
            resolve(d.markdown);
          } catch {
            reject(new Error(`bad response from context.dev (HTTP ${res.statusCode})`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('context.dev timed out')));
    req.on('error', reject);
    req.end();
  });
}

export class LiveFetcher {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.enabled = Boolean(apiKey);
    this.lastFetch = null;
  }

  sources() {
    return Object.entries(SOURCES).map(([key, s]) => ({ key, label: s.label, url: s.url }));
  }

  /**
   * Try live; fall back to whatever the caller already has.
   *
   * Rendering a page through a residential proxy takes 13-25 seconds and
   * occasionally returns nothing. That is too long to leave a caller in silence
   * with no fallback, so a failure degrades to the cached figure and says so —
   * an answer marked "as of August" is useful; a timeout is not.
   */
  async fetch(key) {
    const source = SOURCES[key];
    if (!source) throw new Error(`No live source called "${key}"`);
    if (!this.enabled) throw new Error('Live fetching is not configured (CONTEXT_API_KEY missing)');

    const started = Date.now();
    const markdown = await scrape(source.url, this.apiKey, { country: source.country });
    const values = source.extract(markdown);
    this.lastFetch = {
      key,
      at: new Date().toISOString(),
      ms: Date.now() - started,
      values,
    };
    return { ...this.lastFetch, label: source.label, publisher: source.publisher, url: source.url };
  }
}
