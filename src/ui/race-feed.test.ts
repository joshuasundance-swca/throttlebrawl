import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/api';
import {
  createPopStack,
  createRaceTally,
  createStyleMeter,
  foundPop,
  meterCash,
  meterLabel,
  popCash,
  popLabel,
  smashPop,
  stylePop,
  styleText,
  type MeterRun,
} from './race-feed';
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

  it("stamps a shortcut's first ride with the seconds it saved, as its own chip (W-Q)", () => {
    expect(foundPop(ev('shortcutFound', 0, { savedS: 2.4, gainM: 60 }))).toEqual({
      kind: 'found',
      word: 'FOUND IT -2.4 S',
      points: null,
    });
    expect(foundPop(ev('shortcutFound', 0, {}))?.word).toBe('FOUND IT');
    expect(foundPop(ev('style', 0, { kind: 'nearMiss', points: 5 }))).toBeNull();
    const tally = createRaceTally();
    tally.onEvents([ev('shortcutFound', 3, { savedS: 1.5 }), ev('shortcutFound', 4, { savedS: 9 })], 3);
    expect(tally.takePopups().map((p) => p.word)).toEqual(['FOUND IT -1.5 S']);
  });

  it('names a takedown into a roadside smashable after the smashable, for the rider who sent him (W-T)', () => {
    const named = ev('smash', 2, {
      prop: 7,
      kind: 'lobster-traps',
      name: 'CATCH OF THE DAY',
      takedown: true,
    });
    expect(smashPop(named)).toEqual({
      kind: 'smash:CATCH OF THE DAY',
      word: 'CATCH OF THE DAY',
      points: null,
    });
    // Ridden through, nobody went down: no pop.
    expect(
      smashPop(ev('smash', 2, { prop: 8, kind: 'mailbox', name: 'RETURN TO SENDER', takedown: false })),
    ).toBeNull();
    const tally = createRaceTally();
    tally.onEvents([named, ev('smash', 5, { name: 'METER EXPIRED', takedown: true })], 2);
    expect(tally.takePopups().map((p) => p.word)).toEqual(['CATCH OF THE DAY']);
  });

  it('names a domino takedown DOUBLE, and one further down the line STRIKE (W-Q)', () => {
    const domino = (n: number) => ev('style', 0, { kind: 'takedownCombo', points: 200, combo: 2, domino: n });
    expect(styleText(domino(2))).toBe('DOUBLE +$200');
    expect(styleText(domino(3))).toBe('STRIKE +$200');
    expect(styleText(domino(5))).toBe('STRIKE +$200');
    expect(stylePop(domino(2))?.kind).toBe('domino'); // its own chip, not merged into COMBO
  });

  it('says nothing for a kind it does not know, and leaves out a missing amount', () => {
    expect(styleText(ev('style', 0, { kind: 'moonwalk', points: 5 }))).toBeNull();
    expect(styleText(ev('style', 0, { kind: 'airtime' }))).toBe('AIRTIME');
    expect(styleText(ev('nearMiss', 0, {}))).toBeNull();
  });

  it('names a landed trick, a double flip as such, and keeps each trick its own pop-up (playtest 2)', () => {
    const trick = (t: string, flips: number, points: number) =>
      ev('style', 0, { kind: 'trick', trick: t, flips, points });
    expect(styleText(trick('backflip', 1, 100))).toBe('BACKFLIP +$100');
    expect(styleText(trick('backflip', 2, 200))).toBe('DOUBLE BACKFLIP +$200');
    expect(styleText(trick('frontflip', 1, 100))).toBe('FRONT FLIP +$100');
    expect(styleText(trick('wheelie', 0, 50))).toBe('WHEELIE +$50');
    expect(styleText(trick('whip', 0, 50))).toBe('WHIP +$50');
    expect(styleText(trick('moonwalk', 0, 50))).toBeNull();
    expect(stylePop(trick('backflip', 1, 100))?.kind).not.toBe(stylePop(trick('whip', 0, 50))?.kind);
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

// Playtest 1c (the maintainer: "I'd like to also watch oncoming go up and up as you ride"): a live
// counter for the style run in progress, read from the snapshot's `styleRun` (#192), that lands on
// the awarded cash and merges into that kind's chip.
describe('the live style meter', () => {
  const run = (
    seconds: number,
    cash: number,
    qualifies = seconds >= 2,
    kind: 'oncoming' | 'airtime' = 'oncoming',
  ): MeterRun => ({ kind, seconds, cash, qualifies });

  it('reads a run as a word with its seconds, and its cash', () => {
    expect(meterLabel(run(4.23, 212))).toBe('ONCOMING 4.2s');
    expect(meterCash(run(4.23, 212))).toBe('+$212');
    expect(meterLabel(run(0.71, 40, true, 'airtime'))).toBe('AIRTIME 0.7s');
    expect(meterCash(run(12.5, 1440))).toBe('+$1,440');
  });

  it('shows a run only once it has lasted the show-after time, then follows it up', () => {
    const m = createStyleMeter();
    expect(m.update(run(0.2, 10, false), 0.5)).toEqual({ shown: null, ended: null });
    expect(m.update(run(0.6, 30, false), 0.5).shown).toEqual(run(0.6, 30, false));
    expect(m.update(run(2.1, 105), 0.5).shown).toEqual(run(2.1, 105));
    expect(m.showing?.kind).toBe('oncoming');
  });

  it('ends on the last value shown when the run stops, saying whether it qualified', () => {
    const m = createStyleMeter();
    m.update(run(3.9, 195), 0.5);
    m.update(run(4.2, 212), 0.5);
    expect(m.update(null, 0.5)).toEqual({ shown: null, ended: run(4.2, 212) });
    expect(m.showing).toBeNull();
    // Nothing more ends until a new run is shown.
    expect(m.update(undefined, 0.5)).toEqual({ shown: null, ended: null });
    m.update(run(1.1, 55, false), 0.5);
    expect(m.update(null, 0.5).ended).toEqual(run(1.1, 55, false));
  });

  it('ends the old run and starts the new one when the kind changes', () => {
    const m = createStyleMeter();
    m.update(run(3, 150), 0.5);
    const step = m.update(run(0.6, 40, true, 'airtime'), 0.5);
    expect(step.ended).toEqual(run(3, 150));
    expect(step.shown).toEqual(run(0.6, 40, true, 'airtime'));
  });

  it('ends a run that restarts (its seconds fell), so each stretch lands on its own', () => {
    const m = createStyleMeter();
    m.update(run(3, 150), 0.5);
    const step = m.update(run(0.6, 30, false), 0.5);
    expect(step.ended).toEqual(run(3, 150));
    expect(step.shown).toEqual(run(0.6, 30, false));
  });

  it('ignores a kind it has no word for, and a run that is not a number', () => {
    const m = createStyleMeter();
    const odd = { kind: 'moonwalk', seconds: 3, cash: 9, qualifies: true } as unknown as MeterRun;
    expect(m.update(odd, 0.5)).toEqual({ shown: null, ended: null });
    expect(m.update(run(Number.NaN, 9), 0.5)).toEqual({ shown: null, ended: null });
  });

  it('forgets the run on reset (a new race), ending nothing', () => {
    const m = createStyleMeter();
    m.update(run(3, 150), 0.5);
    m.reset();
    expect(m.showing).toBeNull();
    expect(m.update(null, 0.5)).toEqual({ shown: null, ended: null });
  });
});
