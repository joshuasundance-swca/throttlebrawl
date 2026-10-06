import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/api';
import { createRaceTally, foundPop } from './race-feed';
import { createTicker, popItem, type TickerItem } from './ticker';

// A shortcut found is always shown (playtest 4, the run-A fix batch's live check, new mustFix 1:
// out/sm-westbot-s7.json and s4). On a clean ride of the Seven Mile's old road the sim emits
// `shortcutFound` 65 to 69 ticks (about 1.1 s) after the west hop's landing. By then the landing's AIRTIME
// chip (paid, 1.1 s) and its landing line (1.6 s) hold the strip, a cash-less FOUND IT chip waited 1.5 s
// at most behind a line, and it was dropped; a rival's line followed. The events go through the real
// tally and `popItem`, in the order the sim emits them, on the model's own clock (ms) stepped one sim
// tick at a time as the view does, never wall time.

const TICK_MS = 1000 / 60;
const actor = 0;
const evt = (tick: number, type: SimEvent['type'], data: SimEvent['data'] = {}): SimEvent => ({
  tick,
  type,
  actor,
  data,
});
/** The pop-ups the tally raises for these events, as the strip's items. */
const popsOf = (events: SimEvent[]): TickerItem[] => {
  const tally = createRaceTally();
  tally.onEvents(events, actor);
  return tally.takePopups().map((p) => popItem(p));
};

type Ticker = ReturnType<typeof createTicker>;
/** Items arriving at a time (ms on the model's clock). */
type Arrival = readonly [at: number, items: TickerItem[]];
/** What showed, in order, each word once per showing, and when each word first showed. */
interface Run {
  words: string[];
  firstAt: Map<string, number>;
}
/**
 * Plays the arrivals on a clock that steps one sim tick at a time, as the view steps a frame at a time:
 * an item is pushed on the first step at or after its time, then the strip is stepped.
 */
const play = (arrivals: readonly Arrival[], to: number, t: Ticker = createTicker()): Run => {
  const run: Run = { words: [], firstAt: new Map() };
  const pending = [...arrivals].sort((a, b) => a[0] - b[0]);
  for (let tick = 0; tick * TICK_MS <= to; tick++) {
    const now = tick * TICK_MS;
    for (let next = pending[0]; next && next[0] <= now; next = pending[0]) {
      pending.shift();
      for (const item of next[1]) t.push(item, now);
    }
    const text = t.step(now).item?.text;
    if (text && run.words[run.words.length - 1] !== text) {
      run.words.push(text);
      if (!run.firstAt.has(text)) run.firstAt.set(text, now);
    }
  }
  return run;
};

const airtimePops = () => popsOf([evt(0, 'style', { kind: 'airtime', points: 40, seconds: 1.3 })]);
const landingLine = (): TickerItem => ({ cls: 'line', text: 'FERAL CHICKENS: UNANIMOUS' });
const BARK = 'Missed it by a rounding error.';
const rivalBark = (ref: string): TickerItem => ({
  cls: 'bark',
  tag: 'DEACON VANE',
  text: BARK,
  contentRef: ref,
  dwellMs: 2000,
});
/** A rival's line arrives after the landing line has had the strip (the live check saw one follow it). */
const RIVAL_AT = 3000;
const FOUND = 'FOUND IT -1.0 S';
const found = (tick: number) => popsOf([evt(tick, 'shortcutFound', { savedS: 1, gainM: 12 })]);

/** A clean ride: the landing at 0 (AIRTIME, a landing line, a rival's line a moment later), the find `lag` ticks later. */
const cleanRide = (lag: number): Run =>
  play(
    [
      [0, [...airtimePops(), landingLine()]],
      [RIVAL_AT, [rivalBark('r1')]],
      [lag * TICK_MS, found(lag)],
    ],
    lag * TICK_MS + 6000,
  );

describe('ticker: a shortcut found is always shown (live check, new mustFix 1)', () => {
  it('shows FOUND IT after a clean ride, 65 and 69 ticks after the landing (the live check, both seeds)', () => {
    for (const lag of [65, 69]) {
      const run = cleanRide(lag);
      expect(run.words, `lag ${lag}`).toContain(FOUND);
      // The AIRTIME chip held the strip first, as the live check saw; the landing line is kept, not lost.
      expect(run.words[0], `lag ${lag}`).toBe('AIRTIME');
      expect(run.words, `lag ${lag}`).toContain('FERAL CHICKENS: UNANIMOUS');
    }
  });

  it('shows it within 2 s of the find, whatever chip or line is ahead of it', () => {
    for (let lag = 0; lag <= 400; lag += 5) {
      const shownAt = cleanRide(lag).firstAt.get(FOUND);
      expect(shownAt, `lag ${lag}`).toBeDefined();
      expect(shownAt ?? Infinity, `lag ${lag}`).toBeLessThanOrEqual(lag * TICK_MS + 2000);
    }
  });

  it("keeps #582's order with a flip, its AIRTIME and a landing line all there, and still shows FOUND IT", () => {
    const flipChip = popsOf([evt(0, 'style', { kind: 'trick', trick: 'backflip', flips: 2, points: 240 })]);
    const run = play(
      [
        [0, [...airtimePops(), ...flipChip, landingLine()]],
        [69 * TICK_MS, found(69)],
      ],
      9000,
    );
    expect(run.words).toContain(FOUND);
    expect(run.words.indexOf('DOUBLE BACKFLIP')).toBeGreaterThanOrEqual(0);
    expect(run.words.indexOf('DOUBLE BACKFLIP')).toBeLessThan(run.words.indexOf('AIRTIME'));
  });

  it('takes the strip from a bark, which comes back after it', () => {
    const run = play(
      [
        [0, [rivalBark('r1')]],
        [100, found(0)],
      ],
      6000,
    );
    expect(run.words).toEqual([BARK, FOUND, BARK]);
  });

  it('takes the strip from a landing line, which is kept and comes back after it', () => {
    const run = play(
      [
        [0, [landingLine()]],
        [100, found(0)],
      ],
      6000,
    );
    expect(run.words).toEqual(['FERAL CHICKENS: UNANIMOUS', FOUND, 'FERAL CHICKENS: UNANIMOUS']);
  });

  it('waits its turn behind a name and a paid chip (they go first), and is not dropped waiting', () => {
    const name: TickerItem = { cls: 'name', text: 'CATCH OF THE DAY', dwellMs: 900 };
    const first = play(
      [
        [0, [name]],
        [10, found(0)],
      ],
      4000,
    );
    expect(first.words).toEqual(['CATCH OF THE DAY', FOUND]);
    const second = play(
      [
        [0, airtimePops()],
        [10, found(0)],
      ],
      4000,
    );
    expect(second.words).toEqual(['AIRTIME', FOUND]);
  });

  it('is never pushed out by the queue limit', () => {
    const sys = Array.from({ length: 10 }, (_, i): TickerItem => ({
      cls: 'system',
      text: `SYS ${i}`,
      dwellMs: 100,
    }));
    const run = play(
      [
        [0, [{ cls: 'ask', text: 'ASK', dwellMs: 6000 }]],
        [10, found(0)],
        [20, sys],
      ],
      30_000,
    );
    expect(run.words).toContain(FOUND);
  });

  it('negative control: a missed hop emits no shortcutFound, so the same ride shows no FOUND IT', () => {
    // #581's rule: a respawn is never a find. The sim emits `crash`, `respawn` and a `land` for the fall;
    // none of them raises the stamp, so the strip never shows it. The same measure sees it above.
    const missed = popsOf([evt(40, 'crash'), evt(60, 'respawn'), evt(69, 'land', { surge: false })]);
    expect(missed).toEqual([]);
    const run = play(
      [
        [0, [...airtimePops(), landingLine()]],
        [RIVAL_AT, [rivalBark('r1')]],
        [69 * TICK_MS, missed],
      ],
      9000,
    );
    expect(run.words).toEqual(['AIRTIME', 'FERAL CHICKENS: UNANIMOUS', BARK]);
    expect(foundPop(evt(69, 'respawn'))).toBeNull();
  });
});
