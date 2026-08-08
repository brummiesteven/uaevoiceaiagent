import { z } from 'zod';
import { reply, summarise, sentenceList, pluralise } from './text.js';

/**
 * Tool registry.
 *
 * `voice: true` marks the curated subset to enable on the ElevenLabs agent.
 * The rest stay available to Claude, Cursor and any other MCP client. Tool
 * selection accuracy falls as the surface grows, and a voice agent that picks
 * the wrong tool gives a wrong spoken answer the listener cannot see — so the
 * spoken subset is kept small on purpose.
 */

const dsLine = (d) =>
  `${d.title}${d.entity ? ` (${d.entity})` : ''}`;

/**
 * "Monthly" -> "monthly", but "every Sunday at 12:00 AM" is left alone —
 * blanket lower-casing turns proper nouns into "every sunday".
 */
const freqPhrase = (f) => (f && !/\s/.test(f) ? f.toLowerCase() : f);

const dsCard = (d) => ({
  id: d.id,
  title: d.title,
  entity: d.entity,
  themes: d.themes,
  isStatistics: d.isStatistics,
  views: d.views,
  downloads: d.downloads,
  updateFrequency: d.updateFrequency,
  hasApi: Boolean(d.apiEndpoint),
  url: d.url,
});

export function registerTools(server, { catalogue, indicators, living, voiceOnly = false }) {
  const registry = [];
  const add = (name, cfg, handler) => {
    registry.push({ name, voice: Boolean(cfg.voice), title: cfg.title });
    // The voice endpoint exposes only the curated subset; every client gets the
    // full surface on /mcp. Same code, two audiences.
    if (voiceOnly && !cfg.voice) return;
    server.registerTool(
      name,
      { title: cfg.title, description: cfg.description, inputSchema: cfg.inputSchema || {} },
      async (args) => {
        try {
          return await handler(args || {});
        } catch (err) {
          return reply(
            `Sorry — I could not complete that lookup. ${err.message}`,
            { error: err.message },
          );
        }
      },
    );
  };

  /* ---------------------------------------------------------------- search */

  add('search_datasets', {
    voice: true,
    title: 'Search Dubai datasets',
    description:
      'Search the official Dubai open data catalogue (around 600 datasets) by keyword. ' +
      'IMPORTANT: pass KEYWORDS, not the user\'s full sentence. For "how many parking ' +
      'spaces are there in Dubai?" pass "parking spaces". Full questions return no results. ' +
      'Returns a short spoken summary plus the top matches.',
    inputSchema: {
      query: z.string().describe('Keywords only, e.g. "real estate transactions" or "parking"'),
      theme: z.string().optional().describe('Restrict to a theme, e.g. "Society", "Infrastructure"'),
      entity: z.string().optional().describe('Restrict to a publisher, e.g. "Roads and Transport Authority"'),
      limit: z.number().int().min(1).max(20).optional().describe('How many to return (default 5)'),
    },
  }, ({ query, theme, entity, limit = 5 }) => {
    const { total, results } = catalogue.search(query, { theme, entity, limit });
    if (!results.length) {
      return reply(
        `Nothing came up for "${query}". Worth trying a broader word — "housing" rather than "housing prices in Marina".`,
        { query, total: 0, results: [] },
      );
    }
    // Answer-shaped, not catalogue-shaped. The caller wants to know what Dubai
    // knows about their topic, not how many rows the search returned — so lead
    // with the single best match and what it actually contains. Counts and the
    // full result list stay in structuredContent for non-voice clients.
    const top = results[0];
    const desc = summarise(top.description, 180);
    const speech =
      `${top.entity || 'Dubai'} publishes ${top.title}` +
      (desc ? ` — ${desc}` : '.') +
      (top.updateFrequency ? ` It's updated ${freqPhrase(top.updateFrequency)}.` : '') +
      (total > 1 ? ' There are other angles on this if you want them.' : '');
    return reply(speech, { query, total, best: dsCard(top), results: results.map(dsCard) });
  });

  add('get_dataset', {
    voice: true,
    title: 'Get dataset details',
    description:
      'Get full details of one dataset by its numeric id (ids come from search_datasets). ' +
      'Returns what it covers, who publishes it, how often it updates and whether an API exists.',
    inputSchema: { id: z.number().int().describe('Dataset id, e.g. 470920') },
  }, ({ id }) => {
    const d = catalogue.get(id);
    if (!d) return reply(`I have no dataset with id ${id}.`, { error: 'not_found', id });
    const body = summarise(d.description, 280) || `${d.title} is published by ${d.entity}.`;
    const provenance = d.entity
      ? `That one comes from ${d.entity}${d.updateFrequency ? `, and it's updated ${freqPhrase(d.updateFrequency)}` : ''}.`
      : d.updateFrequency ? `It's updated ${freqPhrase(d.updateFrequency)}.` : '';
    return reply([body, provenance].filter(Boolean).join(' '), d);
  });

  add('find_similar_datasets', {
    title: 'Find similar datasets',
    description: 'Given a dataset id, find related datasets sharing its themes or publisher.',
    inputSchema: {
      id: z.number().int(),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, ({ id, limit = 5 }) => {
    const d = catalogue.get(id);
    if (!d) return reply(`I have no dataset with id ${id}.`, { error: 'not_found', id });
    const scored = catalogue.datasets
      .filter((o) => o.id !== d.id)
      .map((o) => {
        const shared = o.themes.filter((t) => d.themes.includes(t)).length;
        return { o, score: shared * 5 + (o.entity === d.entity ? 3 : 0) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.o.views - a.o.views)
      .slice(0, limit)
      .map((s) => s.o);
    return reply(
      scored.length
        ? `Datasets related to ${d.title}: ${sentenceList(scored.map(dsLine))}.`
        : `I could not find anything closely related to ${d.title}.`,
      { source: dsCard(d), results: scored.map(dsCard) },
    );
  });

  /* ------------------------------------------------------------- browsing */

  add('list_themes', {
    voice: true,
    title: 'List themes',
    description: 'List the top-level themes Dubai publishes data under, with dataset counts.',
  }, () => {
    const rows = catalogue.stats().byTheme;
    return reply(
      `Dubai covers areas like ${sentenceList(rows.slice(0, 5).map(([t]) => t.toLowerCase()))}. ` +
      'Which of those is closest to what you need?',
      { themes: rows.map(([name, count]) => ({ name, count })) },
    );
  });

  add('list_entities', {
    voice: true,
    title: 'List publishers',
    description: 'List the government entities publishing open data, ordered by how much they publish.',
    inputSchema: { limit: z.number().int().min(1).max(80).optional() },
  }, ({ limit = 10 }) => {
    const rows = catalogue.stats().byEntity.slice(0, limit);
    return reply(
      `Most of it comes from bodies like ${sentenceList(rows.slice(0, 4).map(([e]) => e))}. ` +
      'Was there a particular one you had in mind?',
      { totalEntities: catalogue.entities.length, entities: rows.map(([name, count]) => ({ name, count })) },
    );
  });

  add('browse_by_theme', {
    voice: true,
    title: 'Browse datasets by theme',
    description: 'List the most popular datasets within one theme, e.g. "Society" or "Prices".',
    inputSchema: {
      theme: z.string().describe('Theme name, e.g. "Infrastructure"'),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, ({ theme, limit = 5 }) => {
    const { total, results } = catalogue.search('', { theme, limit });
    if (!results.length) {
      const names = catalogue.stats().byTheme.map(([t]) => t);
      return reply(
        `I have nothing under "${theme}". Available themes are ${sentenceList(names)}.`,
        { theme, total: 0, availableThemes: names },
      );
    }
    const top = results[0];
    return reply(
      `Under ${theme}, the one people go to most is ${top.title} from ${top.entity || 'Dubai'}` +
      (summarise(top.description, 150) ? ` — ${summarise(top.description, 150)}` : '.') +
      ' Happy to go deeper on that, or point you somewhere else in this area.',
      { theme, total, best: dsCard(top), results: results.map(dsCard) },
    );
  });

  add('browse_by_entity', {
    title: 'Browse datasets by publisher',
    description: 'List datasets published by one government entity, e.g. "Dubai Land Department".',
    inputSchema: {
      entity: z.string(),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, ({ entity, limit = 5 }) => {
    const { total, results } = catalogue.search('', { entity, limit });
    if (!results.length) {
      return reply(`I have no datasets from "${entity}".`, { entity, total: 0, results: [] });
    }
    return reply(
      `${pluralise(total, 'dataset')} from ${results[0].entity}. Most viewed: ${sentenceList(results.map((d) => d.title))}.`,
      { entity, total, results: results.map(dsCard) },
    );
  });

  add('list_popular_datasets', {
    title: 'List most popular datasets',
    description: 'The most viewed or most downloaded datasets across the whole catalogue.',
    inputSchema: {
      by: z.enum(['views', 'downloads']).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, ({ by = 'views', limit = 5 }) => {
    const results = [...catalogue.datasets].sort((a, b) => b[by] - a[by]).slice(0, limit);
    return reply(
      `Most ${by === 'views' ? 'viewed' : 'downloaded'} datasets in Dubai: ` +
      `${sentenceList(results.map((d) => `${d.title} with ${d[by].toLocaleString('en-US')} ${by}`))}.`,
      { by, results: results.map(dsCard) },
    );
  });

  add('list_recent_datasets', {
    title: 'List recently updated datasets',
    description: 'Datasets most recently added or refreshed on the portal.',
    inputSchema: { limit: z.number().int().min(1).max(20).optional() },
  }, ({ limit = 5 }) => {
    const results = [...catalogue.datasets]
      .filter((d) => d.ingestedAt)
      .sort((a, b) => new Date(b.ingestedAt) - new Date(a.ingestedAt))
      .slice(0, limit);
    return reply(
      `Most recently updated: ${sentenceList(results.map(dsLine))}.`,
      { results: results.map((d) => ({ ...dsCard(d), ingestedAt: d.ingestedAt })) },
    );
  });

  add('list_datasets_by_update_frequency', {
    title: 'Find datasets by update frequency',
    description: 'Find datasets refreshed daily, weekly, monthly, quarterly or annually.',
    inputSchema: {
      frequency: z.string().describe('e.g. "Daily", "Weekly", "Monthly", "Annually"'),
      limit: z.number().int().min(1).max(20).optional(),
    },
  }, ({ frequency, limit = 5 }) => {
    const { total, results } = catalogue.search('', { updateFrequency: frequency, limit });
    if (!results.length) {
      const opts = catalogue.stats().byUpdateFrequency.map(([f, c]) => `${f} (${c})`);
      return reply(
        `Nothing updates "${frequency}". Known frequencies: ${sentenceList(opts.slice(0, 8))}.`,
        { frequency, total: 0 },
      );
    }
    return reply(
      `${pluralise(total, 'dataset')} update ${frequency.toLowerCase()}. For example ${sentenceList(results.map(dsLine))}.`,
      { frequency, total, results: results.map(dsCard) },
    );
  });

  add('list_subthemes', {
    title: 'List subthemes',
    description: 'List the finer-grained subthemes used to categorise Dubai data.',
  }, () => reply(
    `There are ${catalogue.subthemes.length} subthemes, including ${sentenceList(catalogue.subthemes.slice(0, 6).map((s) => s.title))}.`,
    { subthemes: catalogue.subthemes },
  ));

  add('list_publications', {
    title: 'List publications',
    description: 'List statistical publications and reports issued alongside the datasets.',
  }, () => reply(
    `There are ${catalogue.publications.length} publications, including ${sentenceList(catalogue.publications.slice(0, 5).map((p) => p.title))}.`,
    { publications: catalogue.publications },
  ));

  /* ------------------------------------------------------------ real data */

  add('get_dubai_indicator', {
    voice: true,
    title: 'Get a Dubai statistic',
    description:
      'Answer questions about Dubai with an actual published figure — population, ' +
      'daytime population, inflation, GDP growth, producer prices, households, ' +
      'buildings or housing units. Use this whenever someone asks "how many" or ' +
      '"what is the rate of" rather than asking what data exists.',
    inputSchema: {
      indicator: z.string().describe('What to look up, e.g. "population", "inflation", "gdp"'),
    },
  }, ({ indicator }) => {
    const ind = indicators.find(indicator);
    if (!ind) {
      const names = indicators.list.map((i) => i.name);
      return reply(
        `I do not hold a figure for "${indicator}". I can give you ${sentenceList(names)}. ` +
        'For anything else I can find the dataset that covers it.',
        { query: indicator, available: indicators.list.map((i) => i.key) },
      );
    }
    const related = ind.relatedDataset
      ? catalogue.search(ind.relatedDataset, { limit: 1 }).results[0]
      : null;
    const speech = indicators.speak(ind) +
      (related ? ` The underlying dataset is ${related.title}.` : '');
    return reply(speech, { ...ind, relatedDatasetRecord: related ? dsCard(related) : null });
  });

  add('list_indicators', {
    title: 'List available statistics',
    description: 'List every headline figure this server can quote directly.',
  }, () => reply(
    `I can quote ${indicators.list.length} headline figures: ${sentenceList(indicators.list.map((i) => i.name))}.`,
    { capturedAt: indicators.meta?.capturedAt, indicators: indicators.list },
  ));

  add('get_population_profile', {
    voice: true,
    title: 'Get Dubai population profile',
    description:
      'A rounded picture of Dubai\'s population: total residents, gender split, largest ' +
      'age group, households, buildings, housing units and the daytime population ' +
      'including commuters. Use for any broad "tell me about Dubai\'s population" question.',
  }, () => {
    const p = indicators.profile;
    if (!p) return reply('I do not have the population profile loaded.', { error: 'unavailable' });
    const speech =
      `Dubai has about ${p.totalDisplay} residents, and ${(p.daytime.activeIndividuals / 1e6).toFixed(2)} million ` +
      `people are in the city during the day once you include ${(p.daytime.dailyCommuters / 1e6).toFixed(2)} million daily commuters. ` +
      `The population is ${p.gender.male.percent}% male and ${p.gender.female.percent}% female, ` +
      `and the largest age group is ${p.largestAgeGroup.range}, at ${p.largestAgeGroup.percent}%. ` +
      `There are ${p.households.count.toLocaleString('en-US')} households averaging ${p.households.averageSize} people, ` +
      `across ${p.buildings.toLocaleString('en-US')} buildings. ` +
      `Around ${p.newResidentsThisYear.toLocaleString('en-US')} new residents arrived this year. ` +
      `Source: ${p.source}.`;
    return reply(speech, p);
  });

  /* ------------------------------------------------- living in Dubai */

  add('get_accessibility_service', {
    voice: true,
    title: 'People of Determination services',
    description:
      'What People of Determination are entitled to in Dubai — free parking permits, free ' +
      'travel on the Metro and buses, the nol card, Salik toll exemption, wheelchair-accessible ' +
      'taxis, step-free Metro access, low-floor buses, water buses, vehicle adaptation, and ' +
      'priority at service centres. Use this for any question about accessibility, disability ' +
      'support, or getting around with a mobility need. Pass the topic the caller asked about.',
    inputSchema: {
      topic: z.string().describe('What they asked about, e.g. "parking", "nol card", "taxi", "metro", "salik"'),
    },
  }, ({ topic }) => {
    const s = living.findService(topic);
    if (!s) {
      const topics = [...new Set(living.services.map((x) => x.topic))];
      return reply(
        `I'm not sure I've got that one. I can help with ${sentenceList(topics)} — which is closest?`,
        { query: topic, availableTopics: topics },
      );
    }
    const related = living.byTopic(s.topic).filter((x) => x.key !== s.key);
    const speech =
      `${s.detail} That's through ${s.provider} — you can reach them on ${s.contact}.` +
      (related.length ? ` There's also ${related[0].headline.toLowerCase()}, if that's relevant.` : '');
    return reply(speech, { ...s, capturedAt: living.capturedAt, note: living.disclaimer });
  });

  add('list_accessibility_services', {
    voice: true,
    title: 'List People of Determination services',
    description:
      'List what support is available to People of Determination in Dubai. Use when someone ' +
      'asks broadly what help they can get, rather than about one specific thing.',
  }, () => reply(
    `Quite a lot is covered. ${sentenceList(living.services.slice(0, 5).map((s) => s.headline.toLowerCase()))} ` +
    '— and more besides. Which of those would be most useful?',
    { services: living.services.map((s) => ({ key: s.key, topic: s.topic, headline: s.headline })) },
  ));

  add('get_utility_rates', {
    voice: true,
    title: 'Electricity and water costs',
    description:
      'What electricity and water cost in Dubai, from DEWA\'s residential slab tariff. ' +
      'Pass monthlyUsage to estimate an actual bill — kilowatt-hours for electricity, ' +
      'cubic metres for water. Use for any question about utility costs or bills.',
    inputSchema: {
      utility: z.enum(['electricity', 'water']).describe('Which utility'),
      monthlyUsage: z.number().positive().optional()
        .describe('Optional monthly consumption — kWh for electricity, cubic metres for water'),
    },
  }, ({ utility, monthlyUsage }) => {
    const table = living.utilities?.[utility];
    if (!table) return reply('I do not have that tariff loaded.', { error: 'unavailable' });

    if (monthlyUsage) {
      const est = living.estimateUtility(utility, monthlyUsage);
      return reply(
        `For ${monthlyUsage} ${est.spokenUnit} a month you'd be looking at roughly ` +
        `${Math.round(est.total)} dirhams — that's about ${Math.round(est.slabCost)} on the tariff itself ` +
        `plus around ${Math.round(est.fuelSurcharge)} in fuel surcharge. It's a sliding scale, so the more you use ` +
        `the higher the rate on the extra. That's DEWA's residential rate as of ${living.capturedAtSpoken}, worth confirming with them.`,
        { ...est, capturedAt: living.capturedAt },
      );
    }
    const first = table.slabs[0];
    const last = table.slabs[table.slabs.length - 1];
    return reply(
      `DEWA charges on a sliding scale. ${utility === 'electricity' ? 'Electricity' : 'Water'} starts at ` +
      `${first.display} and rises to ${last.display} once you're a heavy user, plus a fuel surcharge of ` +
      `${table.fuelSurcharge.display}. Tell me roughly how much you use in a month and I'll work out the bill.`,
      { utility, slabs: table.slabs, fuelSurcharge: table.fuelSurcharge, capturedAt: living.capturedAt, note: living.disclaimer },
    );
  });

  /* ----------------------------------------------------------------- meta */

  add('get_dataset_api_info', {
    title: 'Get dataset API access details',
    description:
      'For a dataset that exposes a data API, return the endpoint URL and explain how ' +
      'to request an access key. Useful when someone wants the raw rows rather than a description.',
    inputSchema: { id: z.number().int() },
  }, ({ id }) => {
    const d = catalogue.get(id);
    if (!d) return reply(`I have no dataset with id ${id}.`, { error: 'not_found', id });
    if (!d.apiEndpoint) {
      return reply(
        `${d.title} does not publish a data API. You can still view it on the portal.`,
        { id, hasApi: false, url: d.url },
      );
    }
    return reply(
      `${d.title} exposes an API at ${d.apiEndpoint}. Access needs an approved key — ` +
      'you request one through the portal, and the key and secret arrive by email.',
      { id, hasApi: true, endpoint: d.apiEndpoint, url: d.url, howTo: 'Request API access via data.dubai; approval required.' },
    );
  });

  add('get_catalogue_stats', {
    title: 'Get catalogue statistics',
    description: 'Overview of the whole catalogue: totals, split by theme, publisher and update frequency.',
  }, () => {
    const s = catalogue.stats();
    return reply(
      `Dubai publishes ${s.totalDatasets} open datasets from ${s.totalEntities} government entities. ` +
      `${s.statistics} are statistical series and ${s.tabular} are tabular datasets. ` +
      `${s.withApiEndpoint} expose a data API. The biggest themes are ` +
      `${sentenceList(s.byTheme.slice(0, 3).map(([t, c]) => `${t} with ${c}`))}.`,
      s,
    );
  });

  return registry;
}
