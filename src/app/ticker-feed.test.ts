import { describe, expect, it } from 'vitest';
import type { BoardCatalog, BoardItem, VisibleContent } from '../render';
import type { SimEvent } from '../sim/api';
import {
  createSeenPoll,
  landingLineFor,
  landingLineItem,
  producerAskItem,
  producerThanksItem,
  seenKindOf,
  SEEN_POLL_EVERY,
  SLOW_FRAMES_ITEM,
  withoutLandingLines,
} from './ticker-feed';

// Playtest 3, the ticker integration (task T8.2; the design spec "The integration side"): app/ puts
// the producer's asks, the landing one-liners and the slow-frames note on the top ticker, and polls
// the renderer for the signs and billboards in view so the veto's "recently seen" list names them.
// These are the pure parts; the wiring in app/index.ts is covered by the browser specs.

const ME = 7;
const item = (n: number): BoardItem => ({
  ref: `base:region/keys#line-${n}`,
  text: `LINE ${n}`,
  kind: 'sign',
});
const POOL: readonly BoardItem[] = [item(0), item(1), item(2), item(3)];
const land = (actor: number, tick: number, data: SimEvent['data'] = { surge: true }): SimEvent => ({
  tick,
  type: 'land',
  actor,
  data,
});

describe('the landing line for a step', () => {
  it("is one pool item for the player's own landing that paid, with its reference", () => {
    const pick = landingLineFor([land(ME, 120)], ME, POOL, null);
    expect(pick).not.toBeNull();
    expect(POOL).toContain(pick?.item);
  });

  it("is none for a rival's landing, a landing that did not pay, or other events", () => {
    expect(landingLineFor([land(3, 120)], ME, POOL, null)).toBeNull();
    expect(landingLineFor([land(ME, 120, { surge: false })], ME, POOL, null)).toBeNull();
    expect(landingLineFor([land(ME, 120, {})], ME, POOL, null)).toBeNull();
    expect(
      landingLineFor([{ tick: 5, type: 'crash', actor: ME, data: { surge: true } }], ME, POOL, null),
    ).toBeNull();
    expect(landingLineFor([], ME, POOL, null)).toBeNull();
  });

  it('is none from an empty pool, and the only line again from a pool of one', () => {
    expect(landingLineFor([land(ME, 120)], ME, [], null)).toBeNull();
    const only = [item(0)];
    expect(landingLineFor([land(ME, 120)], ME, only, only[0]?.ref ?? null)?.item).toBe(only[0]);
  });

  it('never repeats the line just shown while the pool has another, whatever the tick', () => {
    for (let tick = 0; tick < 64; tick++) {
      for (const last of POOL) {
        const pick = landingLineFor([land(ME, tick)], ME, POOL, last.ref);
        expect(pick?.item.ref, `tick ${tick} after ${last.ref}`).not.toBe(last.ref);
      }
    }
  });

  it('is deterministic: the same tick and history give the same line', () => {
    const a = landingLineFor([land(ME, 333)], ME, POOL, POOL[1]?.ref ?? null);
    const b = landingLineFor([land(ME, 333)], ME, POOL, POOL[1]?.ref ?? null);
    expect(a?.item.ref).toBe(b?.item.ref);
  });

  it('forgets a last line the pool no longer holds (a cut line leaves the pool)', () => {
    const pick = landingLineFor([land(ME, 9)], ME, POOL, 'base:region/keys#cut-gone');
    expect(pick).not.toBeNull();
  });

  it("is the ticker's `line` item: the words on one line, vetoable by the pool item's reference", () => {
    const words: BoardItem = {
      ref: 'base:region/keys#two',
      text: '  TEN OUT OF TEN,\nSAYS A PELICAN ',
      kind: 'sign',
    };
    expect(landingLineItem(words, 240, 'seed-4')).toEqual({
      cls: 'line',
      text: 'TEN OUT OF TEN, SAYS A PELICAN',
      contentRef: 'base:region/keys#two',
      tick: 240,
      raceId: 'seed-4',
    });
  });
});

describe("the producer's items", () => {
  const ask = { text: 'Take a rival down before the bridge.', cash: 300 };

  it('an ask is a PRODUCER ask with its cash, and the thank-you is a short ask item', () => {
    expect(producerAskItem(ask)).toEqual({
      cls: 'ask',
      tag: 'PRODUCER',
      text: 'Take a rival down before the bridge.',
      cash: 300,
    });
    expect(producerThanksItem(ask)).toEqual({
      cls: 'ask',
      tag: 'PRODUCER',
      text: 'Got it.',
      cash: 300,
      dwellMs: 2000,
    });
  });

  it('neither is vetoable: asks are game mechanics, not content', () => {
    expect(producerAskItem(ask)).not.toHaveProperty('contentRef');
    expect(producerThanksItem(ask)).not.toHaveProperty('contentRef');
  });
});

describe('the slow-frames note', () => {
  it('is a system line that says where the offer lives', () => {
    expect(SLOW_FRAMES_ITEM.cls).toBe('system');
    expect(SLOW_FRAMES_ITEM.text).toMatch(/pause menu/i);
    expect(SLOW_FRAMES_ITEM).not.toHaveProperty('contentRef');
  });
});

describe('the renderer gets no landing pool', () => {
  const catalog: BoardCatalog = {
    items: { a: { ref: 'base:region/keys#a', text: 'A', kind: 'sign' } },
    pools: { signs: [item(0)], billboards: [item(1)], landing: [item(2), item(3)] },
  };

  it('empties `landing` and keeps every other item and pool as they were', () => {
    const out = withoutLandingLines(catalog);
    expect(out.pools?.landing).toEqual([]);
    expect(out.pools?.signs).toBe(catalog.pools?.signs);
    expect(out.pools?.billboards).toBe(catalog.pools?.billboards);
    expect(out.items).toBe(catalog.items);
    // The input is not touched: app/ keeps the pool to pick lines from.
    expect(catalog.pools?.landing).toHaveLength(2);
  });

  it('works on a catalog without pools', () => {
    expect(withoutLandingLines({ items: {} }).pools?.landing ?? []).toEqual([]);
  });
});

describe('the poll for what is in view', () => {
  const sign = (n: number): VisibleContent => ({
    ref: `base:region/keys#sign-${n}`,
    kind: 'sign',
    label: `SIGN ${n}`,
  });
  const board = (n: number): VisibleContent => ({
    ref: `base:region/keys#bb-${n}`,
    kind: 'billboard',
    label: `BB ${n}`,
  });

  it('reads the renderer once every 30 frames, and not on the frames between', () => {
    const poll = createSeenPoll();
    let reads = 0;
    const read = () => {
      reads++;
      return [sign(1)];
    };
    for (let i = 0; i < SEEN_POLL_EVERY * 3; i++) poll.frame(read);
    expect(SEEN_POLL_EVERY).toBe(30);
    expect(reads).toBe(3);
  });

  it('notes each ref once per race, with its kind and its words', () => {
    const poll = createSeenPoll(2);
    const out: ReturnType<typeof poll.frame> = [];
    const view = [[sign(1), board(1)], [sign(1), board(1), sign(2)], [sign(2)]];
    let i = 0;
    for (let f = 0; f < 6; f++) out.push(...poll.frame(() => view[Math.min(i++, view.length - 1)] ?? []));
    expect(out).toEqual([
      { contentRef: 'base:region/keys#sign-1', kind: 'sign', label: 'SIGN 1' },
      { contentRef: 'base:region/keys#bb-1', kind: 'billboard', label: 'BB 1' },
      { contentRef: 'base:region/keys#sign-2', kind: 'sign', label: 'SIGN 2' },
    ]);
  });

  it('starts over for a new race: a ref seen last race is noted again', () => {
    const poll = createSeenPoll(1);
    expect(poll.frame(() => [sign(1)])).toHaveLength(1);
    expect(poll.frame(() => [sign(1)])).toHaveLength(0);
    poll.reset();
    expect(poll.frame(() => [sign(1)])).toHaveLength(1);
  });

  it("maps the renderer's kinds onto the veto list's: billboards stay, everything else is a sign", () => {
    expect(seenKindOf('billboard')).toBe('billboard');
    expect(seenKindOf('sign')).toBe('sign');
    expect(seenKindOf('cone')).toBe('sign');
    expect(seenKindOf('line')).toBe('sign');
  });
});
