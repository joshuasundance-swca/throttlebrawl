import { describe, expect, it } from 'vitest';
import { basePackFiles } from '../../content';
import { createLongPress, createManualClock, LONG_PRESS_SLOP_PX } from './long-press';
import {
  createSeenLog,
  isContentRef,
  RECENTLY_SEEN_MAX,
  seenItemOf,
  VETO_LONG_PRESS_MS,
  vetoedRefs,
  type SeenItem,
} from './veto';

const fakeClock = createManualClock;

const item = (n: number, kind: SeenItem['kind'] = 'bark'): SeenItem => ({
  contentRef: `base:bark-set/kevin-core#line-${n}`,
  kind,
  label: `Line ${n}`,
  raceId: 'seed-1',
  tick: n * 60,
});

describe('long-press', () => {
  it('fires after 500 ms held still, with what the press was about', () => {
    expect(VETO_LONG_PRESS_MS).toBe(500);
    const clock = fakeClock();
    const got: string[] = [];
    const lp = createLongPress<string>({ schedule: clock.schedule, onLongPress: (p) => got.push(p) });
    lp.down(1, 100, 100, 'kevin');
    clock.advance(499);
    expect(got).toEqual([]);
    expect(lp.pressing).toBe(true);
    lp.move(1, 100 + LONG_PRESS_SLOP_PX - 1, 100);
    clock.advance(1);
    expect(got).toEqual(['kevin']);
    expect(lp.pressing).toBe(false);
  });

  it('does not fire when released early, dragged away, or for a second finger', () => {
    const clock = fakeClock();
    const got: string[] = [];
    const lp = createLongPress<string>({ schedule: clock.schedule, onLongPress: (p) => got.push(p) });
    lp.down(1, 0, 0, 'tap');
    clock.advance(300);
    lp.up(1);
    clock.advance(1000);
    lp.down(2, 0, 0, 'drag');
    lp.move(2, LONG_PRESS_SLOP_PX + 1, 0);
    clock.advance(1000);
    lp.down(3, 0, 0, 'first');
    lp.down(4, 0, 0, 'second');
    lp.up(4);
    clock.advance(500);
    expect(got).toEqual(['first']);
  });
});

describe('recently seen', () => {
  it('keeps the last 20 items, newest first, one row per item', () => {
    expect(RECENTLY_SEEN_MAX).toBe(20);
    const log = createSeenLog();
    let changes = 0;
    log.onChange(() => changes++);
    for (let i = 1; i <= 25; i++) log.note(item(i));
    expect(log.list().length).toBe(20);
    expect(log.list()[0]?.contentRef).toMatch(/#line-25$/);
    expect(log.list()[19]?.contentRef).toMatch(/#line-6$/);
    // Seen again: moves to the top with its new tick, no duplicate row.
    log.note({ ...item(10), tick: 9999 });
    expect(log.list().length).toBe(20);
    expect(log.list()[0]).toMatchObject({ contentRef: item(10).contentRef, tick: 9999 });
    log.remove(item(10).contentRef);
    expect(log.list().some((i) => i.contentRef === item(10).contentRef)).toBe(false);
    expect(changes).toBe(27);
  });
});

describe('content references', () => {
  it('accept the documented format and every line in the base pack', () => {
    expect(isContentRef('base:bark-set/kevin-core#kevin-pass-email')).toBe(true);
    expect(isContentRef('base:region/florida-keys#ices-before-road')).toBe(true);
    expect(isContentRef('kevin-pass-email')).toBe(false);
    expect(isContentRef('base:bark-set/kevin-core')).toBe(false);
    for (const f of basePackFiles().filter((x) => x.path.startsWith('barks/'))) {
      const set = f.json as { id: string; lines: { id: string }[] };
      for (const l of set.lines) expect(isContentRef(`base:bark-set/${set.id}#${l.id}`), l.id).toBe(true);
    }
  });

  it('read stored flags back into refs, skipping anything malformed', () => {
    expect(
      vetoedRefs([
        { contentRef: 'base:bark-set/kevin-core#kevin-pass-email', raceId: 'r1', tick: 40 },
        'base:region/florida-keys#ices-before-road',
        { contentRef: 'nope' },
        null,
        7,
      ]),
    ).toEqual(['base:bark-set/kevin-core#kevin-pass-email', 'base:region/florida-keys#ices-before-road']);
    expect(vetoedRefs(undefined)).toEqual([]);
  });
});

describe('the item "cut this" offers for a long-press on the strip', () => {
  const shown = {
    contentRef: 'base:bark-set/kevin-core#line-1',
    speakerName: 'KEVIN',
    text: 'Nice wheelie, nerd.',
    raceId: 'seed-1',
    tick: 60,
  };

  it('names a bark as "Speaker: line", a bark', () => {
    expect(seenItemOf(shown)).toEqual({
      contentRef: shown.contentRef,
      kind: 'bark',
      label: 'KEVIN: Nice wheelie, nerd.',
      raceId: 'seed-1',
      tick: 60,
    });
  });

  it('names a landing line by its words alone, as a sign (not a bark with an empty speaker)', () => {
    const line = {
      ...shown,
      contentRef: 'base:region/keys#line-3',
      speakerName: '',
      text: 'TEN OUT OF TEN, SAYS A PELICAN',
      strip: 'line' as const,
    };
    const it = seenItemOf(line);
    expect(it.kind).toBe('sign');
    expect(it.label).toBe('TEN OUT OF TEN, SAYS A PELICAN');
    expect(it.contentRef).toBe(line.contentRef);
  });
});
