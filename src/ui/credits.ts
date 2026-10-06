// The credits page's data and wording (docs/milestones/M5.md, credits-1). dist/credits.json
// is written by the build from the ledger (THIRD_PARTY_ASSETS.md), the packs' licence rules and
// credits and the licence texts (scripts/credits.mjs); this file reads it and says, without a DOM,
// what the page shows, so a test reads the same words the page draws. Pure logic.

export interface Attribution {
  text: string;
  url: string | null;
  licence: string;
}
export interface LedgerEntry {
  asset: string;
  source: string;
  licence: string;
  ai: boolean;
}
export interface LicenceText {
  id: string;
  name: string;
  text: string;
}
export interface SoftwareCredit {
  name: string;
  version: string;
  license: string;
  text: string;
}
export interface CreditsData {
  attributions: Attribution[];
  entries: LedgerEntry[];
  notices: string[];
  licences: LicenceText[];
  software: SoftwareCredit[];
}

const CREDITS_FORMAT = 1;
const str = (v: unknown): v is string => typeof v === 'string';
const rec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function list<T>(v: unknown, read: (r: Record<string, unknown>) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[]).flatMap((x) => {
    const got = rec(x) ? read(x) : null;
    return got ? [got] : [];
  });
}

/** The data from a parsed dist/credits.json; null when it is not this format at all. */
export function parseCredits(data: unknown): CreditsData | null {
  if (!rec(data) || data['format'] !== CREDITS_FORMAT) return null;
  return {
    attributions: list(data['attributions'], (r) =>
      str(r['text'])
        ? {
            text: r['text'],
            url: str(r['url']) ? r['url'] : null,
            licence: str(r['licence']) ? r['licence'] : '',
          }
        : null,
    ),
    entries: list(data['entries'], (r) =>
      str(r['asset']) && str(r['source']) && str(r['licence']) && typeof r['ai'] === 'boolean'
        ? { asset: r['asset'], source: r['source'], licence: r['licence'], ai: r['ai'] }
        : null,
    ),
    notices: (Array.isArray(data['notices']) ? (data['notices'] as unknown[]) : []).filter(str),
    licences: list(data['licences'], (r) =>
      str(r['id']) && str(r['name']) && str(r['text'])
        ? { id: r['id'], name: r['name'], text: r['text'] }
        : null,
    ),
    software: list(data['software'], (r) =>
      str(r['name']) && str(r['version']) && str(r['license']) && str(r['text'])
        ? { name: r['name'], version: r['version'], license: r['license'], text: r['text'] }
        : null,
    ),
  };
}

/** A run of text on the page: plain, or a link, a bold word or a file name. */
export interface Seg {
  text: string;
  href?: string;
  bold?: boolean;
  code?: boolean;
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

/** A ledger cell's markdown (links, bold, code) as runs of text. Anything else stays as written. */
export function inline(text: string): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) {
      // A link out of the page only when it is a web address; a link to a file of the repo is just its words.
      out.push(/^https?:\/\//.test(m[2]) ? { text: m[1], href: m[2] } : { text: m[1] });
    } else if (m[3] !== undefined) out.push({ text: m[3], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], code: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

/** The plain words of a run list. */
export const plain = (segs: readonly Seg[]): string => segs.map((s) => s.text).join('');

/** What a ledger row is called in the list: its asset up to the first bracket or colon. */
export function entryTitle(asset: string): string {
  const words = plain(inline(asset));
  const cut = words.search(/ \(|:/);
  const title = (cut > 0 ? words.slice(0, cut) : words).trim();
  return title === '' ? words.trim() : title;
}

/** The label on a made-by-AI item, in words (colour never carries it alone). */
export const AI_LABEL = 'AI-made';

export interface EntryView {
  title: string;
  ai: boolean;
  /** The rows inside the entry, each a label and its text. */
  details: { label: string; segs: Seg[] }[];
}

export interface CreditsView {
  /** Map data and other credits that name their source. */
  attributions: { segs: Seg[]; url: string | null }[];
  entries: EntryView[];
  notices: Seg[][];
  licences: LicenceText[];
  software: { title: string; licence: string; text: string }[];
}

/** What the page shows, from the data. */
export function creditsView(d: CreditsData): CreditsView {
  return {
    attributions: d.attributions.map((a) => ({ segs: inline(a.text), url: a.url })),
    entries: d.entries.map((e) => ({
      title: entryTitle(e.asset),
      ai: e.ai,
      details: [
        { label: 'What', segs: inline(e.asset) },
        { label: 'Source', segs: inline(e.source) },
        { label: 'Licence', segs: inline(e.licence) },
      ],
    })),
    notices: d.notices.map(inline),
    licences: d.licences,
    software: d.software.map((s) => ({ title: `${s.name} ${s.version}`, licence: s.license, text: s.text })),
  };
}

/** Every word the page shows, in order (a test reads this; the page draws the same view). */
export function viewText(v: CreditsView): string {
  const parts: string[] = [];
  for (const a of v.attributions) parts.push(plain(a.segs), a.url ?? '');
  for (const e of v.entries) {
    parts.push(e.title, e.ai ? AI_LABEL : '');
    for (const row of e.details) parts.push(row.label, plain(row.segs));
  }
  for (const n of v.notices) parts.push(plain(n));
  for (const l of v.licences) parts.push(l.name, l.text);
  for (const s of v.software) parts.push(s.title, s.licence, s.text);
  return parts.join('\n');
}
