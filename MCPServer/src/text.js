/**
 * Text hygiene and prose shaping.
 *
 * Everything the voice agent says passes through here. Two jobs: strip the
 * things that break text-to-speech, and turn record sets into sentences a
 * person can actually listen to.
 */

// The portal ships invisible filler characters inside some publisher names —
// "Dubai Data and Statistics Establishment" carries a run of U+17B4/U+17B5 and
// friends. Left in, TTS either stalls or vocalises them as noise.
const INVISIBLE = /[­឴឵᠋-᠎​-‏‪-‮⁠-⁯﻿]/g;

export function clean(value) {
  if (typeof value !== 'string') return '';
  return value.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** Strip HTML from the portal's rich-text fields so it can be spoken. */
export function stripHtml(value) {
  if (typeof value !== 'string') return '';
  return clean(
    value
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/p>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'),
  );
}

/** Pick the right language out of a Liferay `_i18n` map. */
export function localised(record, field, locale = 'en') {
  const i18n = record?.[`${field}_i18n`];
  const key = locale === 'ar' ? 'ar_SA' : 'en_US';
  return clean(i18n?.[key] || record?.[field] || '');
}

/**
 * Turn a portal description into something a person would say on the phone.
 *
 * Nearly every description opens with catalogue boilerplate — "This dataset
 * provides…", "This statistical report includes…" — and closes with an
 * analyst's note about what the data "can be used to" support. Spoken aloud
 * that is both jargon and padding, and it fights the assistant's persona, so
 * both ends are trimmed and the sentence is restitched.
 */
export function humanise(text) {
  let t = stripHtml(text);
  if (!t) return '';
  t = t.replace(
    /^(this|the)\s+(dataset|data\s?set|statistical\s+report|report|statistic|table|record\s+set)\s+(provides?|contains?|lists?|includes?|presents?|shows?|covers?|offers?|gives?)\s+/i,
    '',
  );
  // Drop the trailing "can be used to…" clause — useful to an analyst, noise aloud.
  t = t.replace(/\s*(the data|it|this)\s+can be used to[\s\S]*$/i, '');
  t = t.replace(/\s*it (is|can be) (used|useful)[\s\S]*$/i, '');
  return t.trim().replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Trim to something speakable. Prefers ending on a full stop — a sentence cut
 * mid-clause with an ellipsis sounds like the line dropped.
 */
export function summarise(text, maxChars = 220) {
  const t = humanise(text);
  if (!t) return '';
  if (t.length <= maxChars) return t.replace(/\.?$/, '.');
  const window = t.slice(0, maxChars + 60);
  const lastStop = window.lastIndexOf('. ');
  if (lastStop > 70) return window.slice(0, lastStop + 1);
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 60 ? lastSpace : maxChars).trim()}.`;
}

/** "a, b and c" — reads far better aloud than comma-separated lists. */
export function sentenceList(items) {
  const v = items.filter(Boolean);
  if (v.length === 0) return '';
  if (v.length === 1) return v[0];
  return `${v.slice(0, -1).join(', ')} and ${v[v.length - 1]}`;
}

export function pluralise(n, singular, plural = `${singular}s`) {
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : plural}`;
}

/**
 * Every tool returns this shape: `speech` is what the agent says, `data` is the
 * structured payload for any non-voice client. Keeping them separate is what
 * stops the agent reading JSON aloud.
 */
export function reply(speech, data) {
  return {
    content: [{ type: 'text', text: speech }],
    structuredContent: data === undefined ? { ok: true } : data,
  };
}
