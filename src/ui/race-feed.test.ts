import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/api';
import { createPopStack, createRaceTally, popCash, popLabel, stylePop, styleText } from './race-feed';
import { resultText } from './format';

// ui-3 (docs/milestones/M2.md): short style pop-ups during the race, and the takedowns and style
// tally on the results screen.

const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}): SimEvent => ({
  tick: 1,
  type,
  actor,
  data,
});

describe('style pop-ups', () => {
  it('names each style kind in a plain, dry word or two, with the cash', () => {
    expect(styleText(ev('style', 0, { kind: 'nearMiss', points: 50 }))).toBe('NEAR MISS +$50');
    expect(styleText(ev('style', 0, { kind: 'oncoming', points: 120 }))).toBe('ONCOMING +$120');
    expect(styleText(ev('style', 0, { kind: 'airtime', points: 75 }))).toBe('AIRTIME +$75');
    expect(styleText(ev('style', 0, { kind: 'takedownCombo', points: 300 }))).toBe('COMBO +$300');
    expect(styleText(ev('style', 0, { kind: 'weaponSteal', points: 40 }))).toBe('STOLEN +$40');
  });

  it('says nothing for a kind it does not know, and leaves out a missing amount', () => {
    expect(styleText(ev('style', 0, { kind: 'moonwalk', points: 5 }))).toBeNull();
    expect(styleText(ev('style', 0, { kind: 'airtime' }))).toBe('AIRTIME');
    expect(styleText(ev('nearMiss', 0, {}))).toBeNull();
  });
});

// Playtest 1c, 2026-09-30 [decided]: less intrusive pop-ups. Repeats merge instead of stacking.
describe('the pop-up stack', () => {
  const pop = (kind: string, points: number | null = 25) => {
    const p = stylePop(ev('style', 0, points === null ? { kind } : { kind, points }));
    if (!p) throw new Error(`no pop-up for ${kind}`);
    return p;
  };

  it('merges repeats of a kind into the pop-up already up, summing the cash', () => {
    const s = createPopStack(3);
    const first = s.add(pop('nearMiss'));
    expect(first.merged).toBe(false);
    expect(s.add(pop('nearMiss')).merged).toBe(true);
    const third = s.add(pop('nearMiss'));
    expect(third.entry).toBe(first.entry);
    expect(s.entries()).toHaveLength(1);
    expect(popLabel(third.entry)).toBe('NEAR MISS ×3');
    expect(popCash(third.entry)).toBe('+$75');
  });

  it('shows a single pop-up without a count, and big cash with separators', () => {
    const s = createPopStack(3);
    const { entry } = s.add(pop('takedownCombo', 12345));
    expect(popLabel(entry)).toBe('COMBO');
    expect(popCash(entry)).toBe('+$12,345');
    const bare = s.add(pop('airtime', null)).entry;
    expect(popLabel(bare)).toBe('AIRTIME');
    expect(popCash(bare)).toBe('');
  });

  it('keeps at most the cap, dropping the oldest, and a merge keeps its place', () => {
    const s = createPopStack(2);
    const near = s.add(pop('nearMiss')).entry;
    const onc = s.add(pop('oncoming')).entry;
    expect(s.add(pop('nearMiss')).dropped).toEqual([]);
    expect(s.entries()).toEqual([near, onc]);
    const air = s.add(pop('airtime'));
    expect(air.dropped).toEqual([near]);
    expect(s.entries()).toEqual([onc, air.entry]);
  });

  it('starts a fresh pop-up once the old one is gone', () => {
    const s = createPopStack(3);
    const old = s.add(pop('nearMiss')).entry;
    s.add(pop('nearMiss'));
    s.remove(old);
    s.remove(old); // twice does nothing
    const fresh = s.add(pop('nearMiss'));
    expect(fresh.merged).toBe(false);
    expect(popLabel(fresh.entry)).toBe('NEAR MISS');
    s.clear();
    expect(s.entries()).toEqual([]);
  });
});

describe('the race tally', () => {
  it("counts the player's takedowns and style, and nobody else's", () => {
    const t = createRaceTally();
    t.onEvents(
      [
        ev('takedown', 0, { kind: 'traffic' }),
        ev('takedown', 3, { kind: 'health' }),
        ev('style', 0, { kind: 'nearMiss', points: 50 }),
        ev('style', 2, { kind: 'airtime', points: 80 }),
        ev('takedown', 0, { kind: 'scenery' }),
      ],
      0,
    );
    expect(t.takedowns).toBe(2);
    expect(t.styleCash).toBe(50);
    const pops = t.takePopups();
    expect(pops).toEqual([{ kind: 'nearMiss', word: 'NEAR MISS', points: 50 }]);
    expect(t.takePopups()).toEqual([]);
  });

  it("prefers the snapshot's style tally, which the sim keeps", () => {
    const t = createRaceTally();
    t.onEvents([ev('style', 0, { kind: 'nearMiss', points: 50 })], 0);
    t.noteSnapshotTally(175);
    expect(t.styleCash).toBe(175);
  });

  it('starts over each race', () => {
    const t = createRaceTally();
    t.onEvents([ev('takedown', 0, { kind: 'traffic' })], 0);
    t.reset();
    expect(t.takedowns).toBe(0);
    expect(t.styleCash).toBe(0);
  });
});

describe('the results screen tally', () => {
  it('adds takedowns and style to the prize line, for a placing and for a bust', () => {
    const win = resultText({
      place: 2,
      of: 5,
      prizeCash: 900,
      eventName: 'X',
      takedowns: 3,
      styleCash: 1250,
    });
    expect(win.headline).toBe('2nd of 5');
    expect(win.tally).toBe('Takedowns: 3. Style: $1,250.');
    const one = resultText({ place: 2, of: 5, prizeCash: 900, eventName: 'X', takedowns: 1, styleCash: 0 });
    expect(one.tally).toBe('Takedowns: 1. Style: $0.');
    const bust = resultText({
      place: 0,
      of: 5,
      prizeCash: 0,
      eventName: 'X',
      busted: true,
      fineCash: 400,
      takedowns: 0,
      styleCash: 60,
    });
    expect(bust.tally).toBe('Takedowns: 0. Style: $60.');
    expect(resultText({ place: 1, of: 5, prizeCash: 1, eventName: 'X' }).tally).toBeNull();
  });
});
