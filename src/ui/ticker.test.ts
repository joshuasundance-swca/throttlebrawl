import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/api';
import { smashPop, stylePop, type MeterRun } from './race-feed';
import {
  TICKER_NAME_MS,
  TICKER_QUEUE_MAX,
  TICKER_RELEASE_GRACE_MS,
  TICKER_VOICE_TAIL_MS,
  createTicker,
  popItem,
  tickerCash,
  tickerLabel,
  tickerPriority,
  type ShownTickerItem,
  type TickerItem,
} from './ticker';

const bark = (ref: string, text = 'Nice wheelie, nerd.', dwellMs = 2000): TickerItem => ({
  cls: 'bark',
  tag: 'DEACON VANE',
  text,
  contentRef: ref,
  dwellMs,
});
const near = (cash: number | null = 50): TickerItem => ({
  cls: 'style',
  text: 'NEAR MISS',
  kind: 'nearMiss',
  cash,
});
const flip = (cash = 240): TickerItem => ({ cls: 'style', text: 'BACKFLIP', kind: 'trick:BACKFLIP', cash });
const landing = (text = 'TEN OUT OF TEN, SAYS A PELICAN'): TickerItem => ({ cls: 'line', text });
const shown = (t: ReturnType<typeof createTicker>, now: number) => t.step(now).item;

describe('ticker: one item at a time', () => {
  it('shows an item at once, then lets it go when its time is up', () => {
    const t = createTicker();
    t.push(near(), 0);
    expect(shown(t, 0)?.text).toBe('NEAR MISS');
    expect(shown(t, 1099)?.text).toBe('NEAR MISS');
    expect(shown(t, 1100)).toBeNull();
  });

  it('reports a change only when what shows differs', () => {
    const t = createTicker();
    expect(t.step(0).changed).toBe(false);
    t.push(near(), 10);
    expect(t.step(20).changed).toBe(true);
    expect(t.step(30).changed).toBe(false);
    expect(t.step(2000).changed).toBe(true);
    expect(t.step(2010).changed).toBe(false);
  });

  it('orders the classes teach, name, ask, bark, system, line, style, meter', () => {
    const order = ['teach', 'name', 'ask', 'bark', 'system', 'line', 'style', 'meter'] as const;
    expect(order.map(tickerPriority)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('ticker: preemption', () => {
  it('lets a bark preempt a cash-less style item, which is dropped as stale', () => {
    const t = createTicker();
    t.push(near(null), 0);
    t.push(bark('a'), 100);
    expect(shown(t, 100)?.cls).toBe('bark');
    // The bark's time passes; the chip does not come back.
    expect(shown(t, 2100)).toBeNull();
    expect(t.waiting()).toEqual([]);
  });

  it('waits an ask behind a bark and shows it when the bark ends, or drops it after 8 s', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 2000), 0);
    t.push({ cls: 'system', text: 'SLOW' }, 0);
    expect(shown(t, 1999)?.cls).toBe('bark');
    expect(shown(t, 2000)?.cls).toBe('system');

    const u = createTicker();
    u.push({ cls: 'system', text: 'LONG', dwellMs: 20_000 }, 0);
    u.push({ cls: 'ask', tag: 'PRODUCER', text: 'Hit someone.', dwellMs: 3000 }, 0);
    // The ask outranks the system line: it takes the strip, the system line waits (never dropped).
    expect(shown(u, 1)?.cls).toBe('ask');

    const v = createTicker();
    v.push({ cls: 'teach', text: 'TAP HIT TO PUNCH', dwellMs: 20_000 }, 0);
    v.push({ cls: 'ask', text: 'asks', dwellMs: 3000 }, 0);
    expect(shown(v, 7999)?.cls).toBe('teach');
    // Eight seconds in the queue and the ask is stale.
    v.step(8001);
    expect(v.waiting()).toEqual([]);
  });

  it('pauses a bark for a name, and the bark resumes with exactly its remaining time', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    expect(shown(t, 1000)?.cls).toBe('bark');
    t.push({ cls: 'name', text: 'CATCH OF THE DAY' }, 1000);
    expect(shown(t, 1000)?.cls).toBe('name');
    expect(shown(t, 1000 + TICKER_NAME_MS - 1)?.cls).toBe('name');
    const back = shown(t, 1000 + TICKER_NAME_MS);
    expect(back?.cls).toBe('bark');
    // 3000 ms in all, 1000 spent: 2000 left, from the resume.
    expect(back?.endsAt).toBe(1000 + TICKER_NAME_MS + 2000);
    expect(shown(t, 1000 + TICKER_NAME_MS + 1999)?.cls).toBe('bark');
    expect(shown(t, 1000 + TICKER_NAME_MS + 2000)).toBeNull();
  });

  it('announces a bark once, when it first shows, not when it resumes', () => {
    const seen: string[] = [];
    const t = createTicker({ onShow: (i) => seen.push(`${i.cls}:${i.contentRef ?? i.text}`) });
    t.push(bark('a', 'x', 3000), 0);
    t.push({ cls: 'name', text: 'NAME' }, 500);
    t.step(500 + TICKER_NAME_MS);
    t.step(5000);
    expect(seen).toEqual(['bark:a', 'name:NAME']);
  });

  it('shows a name for its flash and no longer (the slider reads live)', () => {
    let ms = 500;
    const t = createTicker({ nameMs: () => ms });
    t.push({ cls: 'name', text: 'A' }, 0);
    expect(shown(t, 499)?.text).toBe('A');
    expect(shown(t, 500)).toBeNull();
    ms = 1500;
    t.push({ cls: 'name', text: 'B' }, 600);
    expect(shown(t, 2099)?.text).toBe('B');
    expect(shown(t, 2100)).toBeNull();
  });

  it('drops a line that waited 500 ms behind a bark', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.push({ cls: 'line', text: 'TEN OUT OF TEN' }, 100);
    t.step(599);
    expect(t.waiting()).toHaveLength(1);
    t.step(601);
    expect(t.waiting()).toHaveLength(0);
    expect(shown(t, 3000)).toBeNull();
  });

  it('replaces a waiting bark with a newer one: the latest wins', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 2000), 0);
    t.push(bark('b', 'x', 2000), 100);
    t.push(bark('c', 'x', 2000), 200);
    expect(t.waiting().map((i) => i.contentRef)).toEqual(['c']);
    expect(shown(t, 2000)?.contentRef).toBe('c');
  });

  it('drops a bark that waited more than 2.5 s', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 6000), 0);
    t.push(bark('b', 'x', 2000), 100);
    t.step(2700);
    expect(t.waiting()).toEqual([]);
  });
});

describe('ticker: merging style chips', () => {
  it('merges three near misses within 1.1 s into one item with the dwell restarted', () => {
    const t = createTicker();
    t.push(near(50), 0);
    t.push(near(50), 400);
    t.push(near(50), 800);
    const item = shown(t, 800);
    expect(item?.count).toBe(3);
    expect(item?.cash).toBe(150);
    expect(item && tickerLabel(item)).toBe('NEAR MISS ×3');
    expect(item && tickerCash(item)).toBe('+$150');
    expect(item?.endsAt).toBe(800 + 1100);
  });

  it('merges a repeat into the chip that waits behind a bark', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.push(near(25), 100);
    t.push(near(25), 200);
    const waiting = t.waiting();
    expect(waiting).toHaveLength(1);
    // The paid chip never goes stale: it shows, merged, once the bark ends.
    expect(shown(t, 3000)?.text).toBe('NEAR MISS');
    expect(shown(t, 3000)?.count).toBe(2);
    expect(shown(t, 3000)?.cash).toBe(50);
  });

  it('still drops a cash-less chip that waited more than 1.5 s', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.push(near(null), 100);
    expect(shown(t, 3000)).toBeNull();
    expect(t.waiting()).toEqual([]);
  });

  it('keeps different kinds apart, and a cash-less chip cash-less', () => {
    const t = createTicker();
    t.push({ cls: 'style', text: 'FOUND IT', kind: 'found', cash: null }, 0);
    const item = shown(t, 0);
    expect(item?.cash).toBeNull();
    expect(item && tickerCash(item)).toBe('');
    t.push({ cls: 'style', text: 'AIRTIME', kind: 'airtime', cash: 100 }, 10);
    // Same class, so the second waits behind the first.
    expect(shown(t, 10)?.text).toBe('FOUND IT');
    expect(t.waiting()).toHaveLength(1);
  });

  it('lets a run that paid land on the chip showing and restart it', () => {
    const t = createTicker();
    t.push({ cls: 'style', text: 'ONCOMING', kind: 'oncoming', cash: 200 }, 0);
    t.push({ cls: 'style', text: 'ONCOMING', kind: 'oncoming', cash: 40, landed: true, dwellMs: 1600 }, 500);
    const item = shown(t, 500);
    expect(item?.landed).toBe(true);
    expect(item?.count).toBe(2);
    expect(item?.endsAt).toBe(2100);
  });
});

describe('ticker: a paid style chip is never dropped (the flip behind its landing line)', () => {
  const seen = (t: ReturnType<typeof createTicker>, from: number, to: number) => {
    const out: string[] = [];
    for (let now = from; now <= to; now += 50) {
      const item = shown(t, now);
      const label = item ? `${item.cls}:${tickerLabel(item)}${item.cash ? ' ' + tickerCash(item) : ''}` : '';
      if (label && out[out.length - 1] !== label) out.push(label);
    }
    return out;
  };

  it('shows the landing line, then the flip chip with its cash, when the line comes first', () => {
    const t = createTicker();
    t.push(landing(), 0);
    t.push(flip(), 10);
    expect(seen(t, 10, 4000)).toEqual(['line:TEN OUT OF TEN, SAYS A PELICAN', 'style:BACKFLIP +$240']);
  });

  it('shows the same two, in the same order, when the chip comes first', () => {
    const t = createTicker();
    t.push(flip(), 0);
    t.push(landing(), 10);
    expect(seen(t, 10, 4000)).toEqual(['line:TEN OUT OF TEN, SAYS A PELICAN', 'style:BACKFLIP +$240']);
  });

  it('gives the chip that was taken its remaining time, not a fresh one', () => {
    const t = createTicker();
    t.push(flip(), 0);
    t.push(landing(), 300);
    // The line (1.6 s) runs 300..1900; the chip had 800 ms left of its 1100.
    expect(shown(t, 1899)?.cls).toBe('line');
    const back = shown(t, 1900);
    expect(back?.cls).toBe('style');
    expect(back?.endsAt).toBe(1900 + 800);
    expect(shown(t, 2700)).toBeNull();
  });

  it('keeps a paid chip behind a long run of higher items, however long they last', () => {
    const t = createTicker();
    t.push({ cls: 'teach', text: 'T', dwellMs: 5000 }, 0);
    t.push({ cls: 'ask', text: 'ASK', dwellMs: 3000 }, 50);
    t.push(flip(), 100);
    expect(shown(t, 5000)?.text).toBe('ASK');
    // Waited 8 s by now, and the chip's own 1.5 s is long past.
    expect(shown(t, 8000)?.text).toBe('BACKFLIP');
  });

  it('never counts a paid chip against the six that wait', () => {
    const t = createTicker();
    t.push({ cls: 'teach', text: 'T', dwellMs: 20_000 }, 0);
    for (let i = 0; i < 4; i++) t.push({ cls: 'ask', text: `ask ${i}` }, 1);
    t.push({ cls: 'system', text: 'sys' }, 1);
    t.push(flip(), 1);
    t.push(landing(), 1);
    t.push({ cls: 'system', text: 'sys 2' }, 1);
    const waiting = t.waiting();
    expect(waiting.some((i) => i.text === 'BACKFLIP')).toBe(true);
  });

  it('merges a second paid flip into the one that waits, summing the cash', () => {
    const t = createTicker();
    t.push(landing(), 0);
    t.push(flip(120), 10);
    t.push(flip(120), 20);
    const item = shown(t, 1600);
    expect(item?.count).toBe(2);
    expect(item?.cash).toBe(240);
  });
});

describe('ticker: voice, hold and cut', () => {
  it('extends a bark to its voice plus a tail', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 2000), 0);
    t.extend('a', 5000);
    expect(shown(t, 5000 + TICKER_VOICE_TAIL_MS - 1)?.contentRef).toBe('a');
    expect(shown(t, 5000 + TICKER_VOICE_TAIL_MS)).toBeNull();
    // A voice for another line, or one that ends sooner, changes nothing.
    t.push(bark('b', 'x', 2000), 6000);
    t.extend('a', 9000);
    t.extend('b', 100);
    expect(shown(t, 8000)).toBeNull();
  });

  it('holds an item while a finger rests on it, and gives a grace after the lift', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 2000), 0);
    t.hold(true, 500);
    expect(shown(t, 9000)?.contentRef).toBe('a');
    expect(shown(t, 9000)?.held).toBe(true);
    t.hold(false, 9000);
    expect(shown(t, 9000 + TICKER_RELEASE_GRACE_MS - 1)?.contentRef).toBe('a');
    expect(shown(t, 9000 + TICKER_RELEASE_GRACE_MS)).toBeNull();
  });

  it('lets a lift before the item ran out leave its own time alone', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.hold(true, 500);
    t.hold(false, 800);
    expect(shown(t, 2999)?.contentRef).toBe('a');
    expect(shown(t, 3000)).toBeNull();
  });

  it('does not preempt an item a finger rests on', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.hold(true, 100);
    t.push({ cls: 'name', text: 'N' }, 200);
    expect(shown(t, 200)?.cls).toBe('bark');
    t.hold(false, 300);
    expect(shown(t, 300)?.cls).toBe('name');
  });

  it('cuts the showing item and every waiting one with that reference', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.push({ cls: 'name', text: 'N' }, 100);
    t.cut('a');
    expect(shown(t, 100)?.cls).toBe('name');
    expect(shown(t, 100 + TICKER_NAME_MS)).toBeNull();
    t.push(bark('b', 'x', 3000), 2000);
    t.push({ cls: 'line', text: 'L', contentRef: 'b' }, 2000);
    t.cut('b');
    expect(shown(t, 2000)).toBeNull();
    expect(t.waiting()).toEqual([]);
  });

  it('drops the barks of a finished race but keeps the rest', () => {
    const t = createTicker();
    t.push(bark('a', 'x', 3000), 0);
    t.push({ cls: 'system', text: 'S' }, 0);
    t.clearClass('bark');
    expect(shown(t, 0)?.cls).toBe('system');
  });
});

describe('ticker: the live meter', () => {
  const run = (seconds: number, qualifies = true): MeterRun => ({
    kind: 'oncoming',
    seconds,
    cash: 212,
    qualifies,
  });

  it('shows only when the strip is idle, and ticks in place', () => {
    const t = createTicker();
    t.meter(run(1.2), 0);
    const first = shown(t, 0);
    expect(first?.cls).toBe('meter');
    expect(first?.text).toBe('ONCOMING 1.2s');
    t.meter(run(1.3), 16);
    const next = t.step(16);
    expect(next.item?.text).toBe('ONCOMING 1.3s');
    expect(next.changed).toBe(true);
    // A bark takes the strip; the meter waits and comes back.
    t.push(bark('a', 'x', 2000), 100);
    expect(shown(t, 100)?.cls).toBe('bark');
    expect(shown(t, 2100)?.cls).toBe('meter');
  });

  it('marks a run that has not lasted long enough as pending', () => {
    const t = createTicker();
    t.meter(run(0.6, false), 0);
    expect(shown(t, 0)?.pending).toBe(true);
    t.meter(run(1.6, true), 10);
    expect(shown(t, 10)?.pending).toBe(false);
  });

  it('becomes a style item when it pays, and goes when the run stops unpaid', () => {
    const t = createTicker();
    t.meter(run(2), 0);
    t.meter(null, 100);
    t.push({ cls: 'style', text: 'ONCOMING', kind: 'oncoming', cash: 212, landed: true, dwellMs: 1600 }, 100);
    const item = shown(t, 100);
    expect(item?.cls).toBe('style');
    expect(item?.landed).toBe(true);
    expect(shown(t, 1700)).toBeNull();

    const u = createTicker();
    u.meter(run(1), 0);
    u.meter(null, 50);
    expect(shown(u, 50)).toBeNull();
  });
});

describe('ticker: the drift chain meter (T6.3)', () => {
  const chain = (n: number, cash: number): MeterRun => ({
    kind: 'drift',
    seconds: 1,
    cash,
    qualifies: true,
    chain: n,
  });

  it('reads DRIFT ×2 +$140 as the meter line and follows the chain and the cash in place', () => {
    const t = createTicker();
    t.meter(chain(3, 140), 0);
    const first = shown(t, 0);
    expect(first?.cls).toBe('meter');
    expect(first?.kind).toBe('drift');
    expect(first && tickerLabel(first)).toBe('DRIFT ×2');
    expect(first && tickerCash(first)).toBe('+$140');
    t.meter(chain(4, 190), 16);
    const next = t.step(16);
    expect(next.changed).toBe(true);
    expect(next.item && tickerLabel(next.item)).toBe('DRIFT ×2.5');
    expect(next.item && tickerCash(next.item)).toBe('+$190');
  });

  it('empties visibly on a wipeout: the chain goes and a DRIFT LOST chip takes the strip', () => {
    const t = createTicker();
    t.meter(chain(2, 90), 0);
    expect(shown(t, 0)?.cls).toBe('meter');
    t.meter(null, 100);
    t.push({ cls: 'style', text: 'DRIFT LOST', kind: 'driftLost', cash: null }, 100);
    const lost = shown(t, 100);
    expect(lost?.cls).toBe('style');
    expect(lost?.text).toBe('DRIFT LOST');
    expect(lost && tickerCash(lost)).toBe('');
    // It goes by itself; nothing of the chain comes back.
    expect(shown(t, 100 + 1100)).toBeNull();
  });

  it('lands on its award: the banked drift pop is the chip the meter becomes', () => {
    const t = createTicker();
    t.meter(chain(2, 90), 0);
    t.meter(null, 200);
    const pop = stylePop({ tick: 1, type: 'style', actor: 0, data: { kind: 'drift', points: 90, chain: 2 } });
    expect(pop).not.toBeNull();
    if (!pop) return;
    t.push(popItem(pop, true, 1600), 200);
    const item = shown(t, 200);
    expect(item?.cls).toBe('style');
    expect(item?.landed).toBe(true);
    expect(item && tickerLabel(item)).toBe('DRIFT');
    expect(item && tickerCash(item)).toBe('+$90');
  });
});

describe('ticker: the queue and the stylePopups setting', () => {
  it('keeps at most 6 waiting, dropping the oldest of the lowest class', () => {
    const t = createTicker();
    t.push({ cls: 'teach', text: 'T', dwellMs: 20_000 }, 0);
    for (let i = 0; i < 4; i++) t.push({ cls: 'ask', text: `ask ${i}` }, 1);
    t.push({ cls: 'system', text: 'sys' }, 1);
    t.push({ cls: 'line', text: 'line 1' }, 1);
    t.push({ cls: 'style', text: 'S1', kind: 's1' }, 1);
    t.push({ cls: 'style', text: 'S2', kind: 's2' }, 1);
    const waiting = t.waiting();
    expect(waiting).toHaveLength(TICKER_QUEUE_MAX);
    // The lowest class goes first (the oldest of it): both style chips, never the asks.
    expect(waiting.filter((i) => i.cls === 'ask')).toHaveLength(4);
    expect(waiting.some((i) => i.text === 'S1')).toBe(false);
    expect(waiting.some((i) => i.text === 'S2')).toBe(false);
  });

  it('shows no style or meter item with stylePopups off, and drops what was up', () => {
    const t = createTicker();
    t.push(near(), 0);
    t.meter({ kind: 'oncoming', seconds: 1, cash: 10, qualifies: true }, 0);
    t.setStyleEnabled(false);
    expect(shown(t, 1)).toBeNull();
    t.push(near(), 10);
    t.meter({ kind: 'airtime', seconds: 1, cash: 10, qualifies: true }, 10);
    expect(shown(t, 10)).toBeNull();
    // A bark still shows.
    t.push(bark('a'), 20);
    expect(shown(t, 20)?.cls).toBe('bark');
    t.setStyleEnabled(true);
    t.push(near(), 3000);
    expect(shown(t, 3000)?.cls).toBe('style');
  });

  it('clears everything for a new race', () => {
    const t = createTicker();
    t.push(bark('a'), 0);
    t.push({ cls: 'name', text: 'N' }, 0);
    t.clear();
    expect(shown(t, 1)).toBeNull();
    expect(t.waiting()).toEqual([]);
  });
});

describe('ticker: labels', () => {
  it('writes the repeat count and the cash', () => {
    const item = { text: 'NEAR MISS', count: 3, cash: 1234.4 } as Pick<
      ShownTickerItem,
      'text' | 'count' | 'cash'
    >;
    expect(tickerLabel(item)).toBe('NEAR MISS ×3');
    expect(tickerCash(item)).toBe('+$1,234');
    expect(tickerLabel({ text: 'X', count: 1 })).toBe('X');
  });
});

describe('ticker: the race feed as items', () => {
  const ev = (type: SimEvent['type'], data: SimEvent['data']): SimEvent => ({
    tick: 1,
    type,
    actor: 0,
    data,
  });

  it('merges repeats of a kind from the feed, summing the cash, with big cash separated', () => {
    const t = createTicker();
    const feed = (kind: string, points: number) => {
      const pop = stylePop(ev('style', { kind, points }));
      if (!pop) throw new Error(`no pop-up for ${kind}`);
      t.push(popItem(pop), 0);
    };
    feed('nearMiss', 25);
    feed('nearMiss', 25);
    feed('nearMiss', 25);
    const near = shown(t, 0);
    expect(near && tickerLabel(near)).toBe('NEAR MISS ×3');
    expect(near && tickerCash(near)).toBe('+$75');
    const u = createTicker();
    const combo = stylePop(ev('style', { kind: 'takedownCombo', points: 12345 }));
    if (combo) u.push(popItem(combo), 0);
    const one = shown(u, 0);
    expect(one && tickerLabel(one)).toBe('COMBO');
    expect(one && tickerCash(one)).toBe('+$12,345');
  });

  it('flashes a takedown name as a name, over a style chip, and never merges two', () => {
    const t = createTicker();
    const near = stylePop(ev('style', { kind: 'nearMiss', points: 25 }));
    const named = smashPop(ev('smash', { name: 'CATCH OF THE DAY', takedown: true }));
    if (!near || !named) throw new Error('no pop-up');
    t.push(popItem(near), 0);
    t.push(popItem(named), 100);
    const item = shown(t, 100);
    expect(item?.cls).toBe('name');
    expect(item?.text).toBe('CATCH OF THE DAY');
    expect(item && tickerCash(item)).toBe('');
    t.push(popItem(named), 200);
    // The second name waits as its own item; the paid near miss it took the strip from waits too.
    const waiting = t.waiting();
    expect(waiting.filter((i) => i.cls === 'name')).toHaveLength(1);
    expect(waiting.filter((i) => i.cls === 'style')).toHaveLength(1);
  });

  it('lands a paid run for the time given', () => {
    const pop = stylePop(ev('style', { kind: 'oncoming', points: 212 }));
    if (!pop) throw new Error('no pop-up');
    expect(popItem(pop, true, 1600)).toMatchObject({ cls: 'style', landed: true, dwellMs: 1600, cash: 212 });
    expect(popItem(pop)).not.toHaveProperty('landed');
  });
});
