import { describe, expect, it } from 'vitest';
import * as feed from './ticker-feed';
import type { BoardItem, VisibleContent } from '../render';
import type { SimEvent } from '../sim/api';
import {
  createOutOfBounds,
  createSeenPoll,
  landingLineFor,
  landingLineItem,
  outOfBoundsLineFor,
  producerAskItem,
  producerThanksItem,
  resetOutOfBounds,
  seenKindOf,
  SEEN_POLL_EVERY,
} from './ticker-feed';

// Playtest 3, the ticker integration (task T8.2; the design spec "The integration side"): app/ puts
// the producer's asks and the landing one-liners on the top ticker, and polls
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

describe('the slow-frames offer', () => {
  it('is shown once, as the toast: the feed has no ticker note for it', () => {
    // The toast carries the offer's buttons; a second line on the strip would say it twice.
    expect(Object.keys(feed).filter((k) => /slow/i.test(k))).toEqual([]);
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
  });
});

// The physical world (the maintainer, 2026-10-06, [decided]: a road race in a physical world with honest edges):
// out of bounds is one quick reset, and it reads at a glance: a short, plain line on the top ticker, a `system`
// line (a transient item in the strip's own slot, never over a control; docs/architecture.md, "Transient
// cards"), for a fall that has no gag of its own: out of bounds onto ground, or a low drop onto it. A splash into
// water keeps its gator or fisherman, and a high drop is a clean cut-away with no line of text (tone guide).
const fall = (actor: number, data: SimEvent['data'], tick = 300): SimEvent => ({
  tick,
  type: 'splash',
  actor,
  data: { body: 'rider', penaltyTicks: 240, ...data },
});
const woke = (actor: number, tick = 540): SimEvent => ({
  tick,
  type: 'respawn',
  actor,
  data: { reason: 'splash' },
});

describe('the out-of-bounds line', () => {
  it('is a plain system line, with the wait in seconds, for the player’s fall onto ground or a low drop', () => {
    for (const past of ['ground', 'drop']) {
      const state = createOutOfBounds();
      const line = outOfBoundsLineFor([fall(ME, { past, high: false })], ME, state);
      expect(line, past).toEqual({ cls: 'system', text: 'OUT OF BOUNDS. BACK ON THE ROAD IN 4 SECONDS.' });
    }
  });

  it('is short and plain: one sentence pair, no shouting or winking', () => {
    const line = outOfBoundsLineFor([fall(ME, { past: 'ground' })], ME, createOutOfBounds());
    expect(line?.text.length ?? 99).toBeLessThanOrEqual(48);
    expect(line?.text).not.toMatch(/[!?…]|\.\.\./);
  });

  it('says the wait the sim asked for: a second, two, six', () => {
    const wait = (ticks: number) =>
      outOfBoundsLineFor([fall(ME, { past: 'ground', penaltyTicks: ticks })], ME, createOutOfBounds())?.text;
    expect(wait(60)).toBe('OUT OF BOUNDS. BACK ON THE ROAD IN 1 SECOND.');
    expect(wait(120)).toBe('OUT OF BOUNDS. BACK ON THE ROAD IN 2 SECONDS.');
    expect(wait(360)).toBe('OUT OF BOUNDS. BACK ON THE ROAD IN 6 SECONDS.');
    // No wait in the event (an older recording): still the line, with no number to get wrong.
    const bare: SimEvent = { tick: 300, type: 'splash', actor: ME, data: { past: 'ground' } };
    expect(outOfBoundsLineFor([bare], ME, createOutOfBounds())?.text).toBe(
      'OUT OF BOUNDS. BACK ON THE ROAD SOON.',
    );
  });

  it('is none for a splash into water (the gator and the fisherman say it) or a high drop (a clean cut-away)', () => {
    expect(outOfBoundsLineFor([fall(ME, { past: 'water' })], ME, createOutOfBounds())).toBeNull();
    expect(
      outOfBoundsLineFor([fall(ME, { past: 'water', high: false })], ME, createOutOfBounds()),
    ).toBeNull();
    for (const past of ['ground', 'drop', 'water'])
      expect(outOfBoundsLineFor([fall(ME, { past, high: true })], ME, createOutOfBounds()), past).toBeNull();
  });

  it('is none for a rival’s fall, for other events, and for a splash that says nothing of where', () => {
    expect(outOfBoundsLineFor([fall(3, { past: 'ground' })], ME, createOutOfBounds())).toBeNull();
    expect(outOfBoundsLineFor([woke(ME)], ME, createOutOfBounds())).toBeNull();
    expect(outOfBoundsLineFor([fall(ME, {})], ME, createOutOfBounds())).toBeNull();
    expect(outOfBoundsLineFor([], ME, createOutOfBounds())).toBeNull();
  });

  it('says it once a fall: the bike’s splash after the rider’s adds nothing, and the next fall says it again', () => {
    const state = createOutOfBounds();
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground' }, 300)], ME, state)).not.toBeNull();
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground', body: 'bike' }, 302)], ME, state)).toBeNull();
    // A rival waking is not the player waking.
    outOfBoundsLineFor([woke(3, 400)], ME, state);
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground' }, 410)], ME, state)).toBeNull();
    outOfBoundsLineFor([woke(ME, 540)], ME, state);
    expect(outOfBoundsLineFor([fall(ME, { past: 'drop' }, 900)], ME, state)).not.toBeNull();
  });

  it('a fall and the waking in one step still says the line, and a new race starts clean', () => {
    const state = createOutOfBounds();
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground' }), woke(ME)], ME, state)).not.toBeNull();
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground' }, 700)], ME, state)).not.toBeNull();
    state.open = true;
    resetOutOfBounds(state);
    expect(outOfBoundsLineFor([fall(ME, { past: 'ground' }, 5)], ME, state)).not.toBeNull();
  });
});
