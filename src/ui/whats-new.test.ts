import { describe, expect, it } from 'vitest';
import {
  cardLines,
  changelogDays,
  headlineOf,
  parseChangelog,
  sameBuild,
  whatsNewSince,
  type ChangelogNote,
} from './whats-new';

// ui-3 (docs/milestones/M2.md): the "what's new since you last played" card and the changelog
// page, from dist/changelog.json (scripts/changelog-build.mjs writes it newest first).

const note = (
  id: string,
  commit: string | null,
  date: string | null,
  audience = 'player',
  text = `${id} text.`,
): ChangelogNote => ({ id, kind: 'new', audience, text, commit, date });

// Newest first, as changelog:build writes them. Two notes can share one merge commit.
const NOTES: ChangelogNote[] = [
  note('d', 'dddddddd', '2026-09-30T12:00:00+00:00'),
  note('c-dev', 'cccccccc', '2026-09-30T11:00:00+00:00', 'dev'),
  note('c', 'cccccccc', '2026-09-30T11:00:00+00:00'),
  note('b', 'bbbbbbbb', '2026-09-30T10:00:00+00:00'),
  note('a', 'aaaaaaaa', '2026-09-29T10:00:00+00:00'),
];

describe("what's new since you last played", () => {
  it('shows only player notes newer than the stored build', () => {
    const w = whatsNewSince(NOTES, 'bbbbbbb');
    expect(w.kind).toBe('notes');
    expect(w.kind === 'notes' && w.notes.map((n) => n.id)).toEqual(['d', 'c']);
  });

  it('shows nothing when there is nothing newer', () => {
    expect(whatsNewSince(NOTES, 'ddddddd')).toEqual({ kind: 'none' });
    // Only a developer note is newer: still nothing for the player.
    expect(whatsNewSince(NOTES.slice(1), 'ccccccc')).toEqual({ kind: 'none' });
  });

  it('shows a short welcome on a first launch instead of the whole history', () => {
    expect(whatsNewSince(NOTES, undefined)).toEqual({ kind: 'welcome' });
    expect(whatsNewSince(NOTES, '')).toEqual({ kind: 'welcome' });
  });

  it('shows nothing for a build it cannot place (a branch build, a trimmed changelog)', () => {
    expect(whatsNewSince(NOTES, '1234567')).toEqual({ kind: 'none' });
    expect(whatsNewSince([], 'bbbbbbb')).toEqual({ kind: 'none' });
  });

  it('counts a note not yet committed (a local build) as newest', () => {
    const w = whatsNewSince([note('local', null, null), ...NOTES], 'ddddddd');
    expect(w.kind === 'notes' && w.notes.map((n) => n.id)).toEqual(['local']);
  });

  it('matches build ids of different abbreviation lengths', () => {
    expect(sameBuild('bbbbbbb', 'bbbbbbbb')).toBe(true);
    expect(sameBuild('bbbbbbbb', 'bbbbbbb')).toBe(true);
    expect(sameBuild('bbbbbbb', 'bbbbbbc')).toBe(false);
    expect(sameBuild('bb', 'bbbbbbb')).toBe(false); // too short to be an id
  });
});

describe('the changelog file', () => {
  it('reads the notes and drops malformed ones', () => {
    const parsed = parseChangelog({
      format: 1,
      notes: [
        {
          id: 'x',
          kind: 'new',
          audience: 'player',
          text: 'Hi.',
          commit: 'abc1234',
          date: '2026-09-30T00:00:00Z',
        },
        { id: 'y', kind: 'new', audience: 'player' }, // no text
        'junk',
      ],
    });
    expect(parsed.map((n) => n.id)).toEqual(['x']);
    expect(parseChangelog(null)).toEqual([]);
    expect(parseChangelog({ format: 99, notes: [] })).toEqual([]);
  });

  it('shortens a note to its first sentence for the card', () => {
    expect(headlineOf('Cops now chase you. Go down near one and you are busted.')).toBe(
      'Cops now chase you.',
    );
    expect(headlineOf('No full stop at all')).toBe('No full stop at all');
    const long = `${'word '.repeat(60)}end.`;
    expect(headlineOf(long).length).toBeLessThanOrEqual(141);
    expect(headlineOf(long).endsWith('…')).toBe(true);
  });

  it('caps the card at four lines and points to the page for the rest', () => {
    const many = Array.from({ length: 7 }, (_, i) => note(`n${i}`, `${i}`.repeat(8), null));
    const lines = cardLines(many);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('And 3 more on the changelog page.');
    expect(cardLines(many.slice(0, 2))).toHaveLength(2);
  });

  it('groups the page by day, newest first, player notes apart from developer notes', () => {
    const days = changelogDays(NOTES, 'player');
    expect(days.map((d) => d.day)).toEqual(['2026-09-30', '2026-09-29']);
    expect(days[0]?.notes.map((n) => n.id)).toEqual(['d', 'c', 'b']);
    expect(changelogDays(NOTES, 'dev').flatMap((d) => d.notes.map((n) => n.id))).toEqual(['c-dev']);
    expect(changelogDays([note('local', null, null)], 'player')[0]?.day).toBe('not yet released');
  });
});
