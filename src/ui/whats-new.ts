// What's new since you last played, and the changelog page (docs/milestones/M2.md, ui-3;
// docs/engineering.md, "What-changed notes, in-game changelog and releases"). Pure logic, no DOM.
// `changelog:build` writes dist/changelog.json with every note, newest first, each with the date
// and commit where its file first appeared. Every merge to main adds at least one note, so a prod
// build id is the commit of its own notes: the device's `lastSeenBuild` finds its place in the list.

export interface ChangelogNote {
  id: string;
  kind: string;
  audience: string;
  text: string;
  /** When the note first appeared on main; null for a note not committed yet (a local build). */
  date: string | null;
  commit: string | null;
}

export type WhatsNew = { kind: 'welcome' } | { kind: 'notes'; notes: ChangelogNote[] } | { kind: 'none' };

const CHANGELOG_FORMAT = 1;
/** A build id or commit shorter than this cannot be told apart from others. */
const MIN_ID = 7;
/** Notes on the card; the rest are a line pointing to the page. */
export const CARD_NOTES = 4;
const HEADLINE_MAX = 140;

const str = (v: unknown): v is string => typeof v === 'string';

/** The notes from a parsed dist/changelog.json; anything malformed is dropped, never thrown. */
export function parseChangelog(data: unknown): ChangelogNote[] {
  if (typeof data !== 'object' || data === null) return [];
  const d = data as { format?: unknown; notes?: unknown };
  if (d.format !== CHANGELOG_FORMAT || !Array.isArray(d.notes)) return [];
  const out: ChangelogNote[] = [];
  for (const n of d.notes as unknown[]) {
    if (typeof n !== 'object' || n === null) continue;
    const r = n as Record<string, unknown>;
    if (!str(r['id']) || !str(r['text']) || !str(r['audience']) || !str(r['kind'])) continue;
    out.push({
      id: r['id'],
      kind: r['kind'],
      audience: r['audience'],
      text: r['text'],
      date: str(r['date']) ? r['date'] : null,
      commit: str(r['commit']) ? r['commit'] : null,
    });
  }
  return out;
}

/** Two ids name the same commit when the shorter is a prefix of the longer (abbreviations differ). */
export function sameBuild(a: string, b: string): boolean {
  if (a.length < MIN_ID || b.length < MIN_ID) return false;
  return a.startsWith(b) || b.startsWith(a);
}

const time = (date: string | null) => (date === null ? Infinity : Date.parse(date));

/**
 * The card for a device that last saw `lastSeen`: a welcome on a first launch, the player notes
 * newer than that build, or nothing. A build the list cannot place shows nothing: guessing would
 * either repeat old news or nag every launch.
 */
export function whatsNewSince(
  notes: readonly ChangelogNote[],
  lastSeen: string | null | undefined,
): WhatsNew {
  if (!lastSeen) return { kind: 'welcome' };
  const seen = notes.find((n) => n.commit !== null && sameBuild(n.commit, lastSeen));
  if (!seen) return { kind: 'none' };
  const cutoff = time(seen.date);
  const newer = notes.filter((n) => n.audience === 'player' && time(n.date) > cutoff);
  return newer.length ? { kind: 'notes', notes: newer } : { kind: 'none' };
}

/** A note's first sentence, for the card, cut at a word near the limit. */
export function headlineOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const m = /^.*?[.!?](?=\s|$)/.exec(flat);
  const first = m ? m[0] : flat;
  if (first.length <= HEADLINE_MAX) return first;
  const cut = first.slice(0, HEADLINE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : HEADLINE_MAX)}…`;
}

/** The card's lines: up to four headlines, then a pointer to the page for the rest. */
export function cardLines(notes: readonly ChangelogNote[]): string[] {
  const lines = notes.slice(0, CARD_NOTES).map((n) => headlineOf(n.text));
  const rest = notes.length - CARD_NOTES;
  if (rest > 0) lines.push(`And ${rest} more on the changelog page.`);
  return lines;
}

export interface ChangelogDay {
  /** `yyyy-mm-dd`, or "not yet released" for uncommitted notes. */
  day: string;
  notes: ChangelogNote[];
}

/** One audience's notes grouped by day, keeping the file's newest-first order. */
export function changelogDays(notes: readonly ChangelogNote[], audience: 'player' | 'dev'): ChangelogDay[] {
  const days: ChangelogDay[] = [];
  for (const n of notes) {
    if (n.audience !== audience) continue;
    const day = n.date ? n.date.slice(0, 10) : 'not yet released';
    const last = days[days.length - 1];
    if (last && last.day === day) last.notes.push(n);
    else days.push({ day, notes: [n] });
  }
  return days;
}
