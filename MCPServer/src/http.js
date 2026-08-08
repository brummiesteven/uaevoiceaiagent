import { get as httpsGet } from 'node:https';

/**
 * The ONLY place this project talks to the network.
 *
 * Deliberately uses node's `https` module rather than global `fetch`.
 * Verified against data.dubai on 8 Aug 2026: for multi-word queries such as
 * `search=real%20estate`, undici (node's global fetch) returns HTTP 200 with a
 * well-formed body and `totalCount: 0`, while curl and `https` both return 26.
 * It is a silent wrong answer, not an error, so it looks exactly like
 * "no results". Do not swap this back to fetch without re-running
 * `npm run smoke` and confirming multi-word searches still return hits.
 *
 * Keeping every request behind this one function also means a future
 * Cloudflare Workers port (where only fetch exists) has a single site to change.
 */

const UA = 'dubai-open-data-mcp/1.0 (+hackathon)';

/**
 * Build a query string. `URLSearchParams` is avoided on purpose: it encodes
 * spaces as `+`, which this Liferay endpoint matches literally and so returns
 * nothing. Percent-encoding is required.
 */
export function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
}

export function getJSON(url, { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsGet(
      url,
      { headers: { Accept: 'application/json', 'User-Agent': UA } },
      (res) => {
        if (res.statusCode >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} from ${url}`));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Malformed JSON from ${url}`));
          }
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`)));
    req.on('error', reject);
  });
}
