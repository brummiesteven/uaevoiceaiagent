/**
 * End-to-end smoke test over the MCP wire protocol.
 *
 * Run against a live server: `node scripts/smoke.js [baseUrl]`
 * Defaults to http://localhost:8787/mcp. Pass the tunnel URL to verify the
 * public path ElevenLabs will actually use.
 */
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const BASE = process.argv[2] || 'http://localhost:8787/mcp';
let id = 0;

function rpc(method, params) {
  const url = new URL(BASE);
  const payload = JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params });
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          // Streamable HTTP may answer as JSON or as a single SSE frame.
          const frame = body.includes('data: ')
            ? body.split('data: ').pop().trim()
            : body.trim();
          try { resolve(JSON.parse(frame)); } catch { reject(new Error(`unparseable: ${body.slice(0, 200)}`)); }
        });
      },
    );
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(payload);
  });
}

const speech = (r) => r?.result?.content?.[0]?.text ?? `ERROR: ${JSON.stringify(r?.error ?? r).slice(0, 160)}`;
const data = (r) => r?.result?.structuredContent ?? {};

// The agent is a phone assistant, not a catalogue browser: it must never recite
// how many datasets matched. Prose gets tuned often, so this asserts the rule
// rather than any particular wording.
const LEAKS = [/\d+\s+datasets?\s+match/i, /\bI found \d+\b/i, /\bdataset id\b/i, /https?:\/\//i];
const leaks = (t) => LEAKS.filter((re) => re.test(t)).map(String);

let pass = 0;
let fail = 0;
function check(label, condition, detail) {
  if (condition) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; console.log(`  ✗ ${label}\n      ${detail}`); }
}

console.log(`\nSmoke testing ${BASE}\n`);

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '1' },
});

const list = await rpc('tools/list', {});
const tools = list?.result?.tools ?? [];
check(`tools/list returns tools (${tools.length})`, tools.length >= 15, JSON.stringify(list).slice(0, 200));

const call = (name, args) => rpc('tools/call', { name, arguments: args });

console.log('\n— catalogue —');
const s1 = await call('search_datasets', { query: 'real estate' });
check('multi-word search returns hits (the undici bug)', data(s1).total > 0, JSON.stringify(data(s1)).slice(0, 160));
check('best match is a real-estate dataset', /real.?estate/i.test(data(s1).best?.title || ''), data(s1).best?.title);
check('search answer does not recite dataset counts', leaks(speech(s1)).length === 0, `leaked: ${leaks(speech(s1))}`);
console.log(`      ${speech(s1).slice(0, 150)}`);

const s2 = await call('search_datasets', { query: 'parking' });
check('single-word search works', data(s2).total > 0, speech(s2));

const s3 = await call('search_datasets', { query: 'zzzznotathing' });
check('no-match path is graceful', data(s3).total === 0 && speech(s3).length > 20, speech(s3));

const st = await call('get_catalogue_stats', {});
check('catalogue has 598 datasets', /598 open datasets/.test(speech(st)), speech(st));
console.log(`      ${speech(st).slice(0, 170)}`);

const th = await call('browse_by_theme', { theme: 'Society' });
check('browse_by_theme works', !/nothing under/.test(speech(th)), speech(th));

console.log('\n— real numbers —');
const pop = await call('get_dubai_indicator', { indicator: 'population' });
check('population figure quoted', /4\.74 million/.test(speech(pop)), speech(pop));
console.log(`      ${speech(pop).slice(0, 170)}`);

const inf = await call('get_dubai_indicator', { indicator: 'inflation' });
check('inflation figure quoted', /2\.79%/.test(speech(inf)), speech(inf));
console.log(`      ${speech(inf).slice(0, 170)}`);

const prof = await call('get_population_profile', {});
check('population profile speaks', /6\.39 million|6\.39/.test(speech(prof)), speech(prof));
console.log(`      ${speech(prof).slice(0, 220)}…`);

const unknown = await call('get_dubai_indicator', { indicator: 'number of camels' });
check('unknown indicator degrades gracefully', /do not hold a figure/.test(speech(unknown)), speech(unknown));

console.log('\n— error handling —');
const bad = await call('get_dataset', { id: 999999999 });
check('missing dataset handled', /no dataset with id/.test(speech(bad)), speech(bad));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
