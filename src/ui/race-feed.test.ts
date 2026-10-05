import { describe, expect, it } from 'vitest';
import { STYLE_KINDS, TRICK_IDS, type SimEvent } from '../sim/api';
import {
  createRaceTally,
  createStyleMeter,
  driftMultiplier,
  foundPop,
  hoodPop,
  meterCash,
  meterLabel,
  smashPop,
  stylePop,
  styleText,
  wheelieCrashPop,
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

  it('words every style kind the sim can pay, so a paid move never goes without a ticker line (the wave A live check)', () => {
    // The live check: 5 paid wheelies and 5 drift banks gave 0 ticker lines, because stylePop had no
    // word for them. Every kind in the sim's own list must pop, and every trick it names.
    const unworded: string[] = [];
    for (const kind of STYLE_KINDS) {
      if (kind === 'trick') {
        for (const trick of TRICK_IDS)
          if (!stylePop(ev('style', 0, { kind, trick, flips: 1, points: 50 })))
            unworded.push(`trick:${trick}`);
      } else if (!stylePop(ev('style', 0, { kind, points: 50 }))) unworded.push(kind);
    }
    expect(unworded).toEqual([]);
  });

  it('pops a paid wheelie and a banked drift with their cash, each its own merge key (playtest 3)', () => {
    expect(styleText(ev('style', 0, { kind: 'wheelie', points: 140, seconds: 3.2, sweetS: 2.5 }))).toBe(
      'WHEELIE +$140',
    );
    expect(styleText(ev('style', 0, { kind: 'drift', points: 210, chain: 2 }))).toBe('DRIFT +$210');
    // The landed-wheelie trick and the wheelie ridden on the road are different pops: they do not merge.
    expect(stylePop(ev('style', 0, { kind: 'wheelie', points: 1 }))?.kind).not.toBe(
      stylePop(ev('style', 0, { kind: 'trick', trick: 'wheelie', flips: 0, points: 1 }))?.kind,
    );
    const tally = createRaceTally();
    tally.onEvents(
      [ev('style', 0, { kind: 'wheelie', points: 140 }), ev('style', 0, { kind: 'drift', points: 210 })],
      0,
    );
    expect(tally.takePopups().map((p) => p.word)).toEqual(['WHEELIE', 'DRIFT']);
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
      name: true,
    });
    // Ridden through, nobody went down: no pop.
    expect(
      smashPop(ev('smash', 2, { prop: 8, kind: 'mailbox', name: 'RETURN TO SENDER', takedown: false })),
    ).toBeNull();
    const tally = createRaceTally();
    tally.onEvents([named, ev('smash', 5, { name: 'METER EXPIRED', takedown: true })], 2);
    expect(tally.takePopups().map((p) => p.word)).toEqual(['CATCH OF THE DAY']);
  });

  it('names a wheelie launch HOOD ORNAMENT off a hood and TRUNK SPACE off a car’s back, for the player only (P4-2)', () => {
    const hood = ev('hoodLaunch', 2, { part: 'hood', closingMps: 50, flips: 2 });
    const trunk = ev('hoodLaunch', 2, { part: 'trunk', closingMps: 3.4, flips: 1 });
    expect(hoodPop(hood)).toEqual({
      kind: 'hood:HOOD ORNAMENT',
      word: 'HOOD ORNAMENT',
      points: null,
      name: true,
    });
    expect(hoodPop(trunk)?.word).toBe('TRUNK SPACE');
    expect(hoodPop(ev('crash', 2, { part: 'trunk' }))).toBeNull();
    const tally = createRaceTally();
    tally.onEvents([trunk, ev('hoodLaunch', 5, { part: 'hood' }), hood], 2);
    expect(tally.takePopups().map((p) => p.word)).toEqual(['TRUNK SPACE', 'HOOD ORNAMENT']);
  });

  it('gives a wheelie crash its one-word reason, and a crash with none no pop (P4-2)', () => {
    const why = ev('crash', 2, { cause: 'traffic', hit: 'frontal', wheelieReason: 'LOW' });
    expect(wheelieCrashPop(why)).toEqual({ kind: 'wheelieCrash:LOW', word: 'LOW', points: null, name: true });
    expect(wheelieCrashPop(ev('crash', 2, { cause: 'traffic', hit: 'frontal' }))).toBeNull();
    expect(wheelieCrashPop(ev('wobble', 2, { wheelieReason: 'LOW' }))).toBeNull();
    const tally = createRaceTally();
    tally.onEvents([why, ev('crash', 2, { cause: 'traffic' }), ev('crash', 5, { wheelieReason: 'BIG' })], 2);
    expect(tally.takePopups().map((p) => p.word)).toEqual(['LOW']);
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
    expect(styleText(trick('newspaper', 0, 150))).toBe('THE NEWSPAPER +$150');
    expect(styleText(trick('moonwalk', 0, 50))).toBeNull();
    expect(stylePop(trick('backflip', 1, 100))?.kind).not.toBe(stylePop(trick('whip', 0, 50))?.kind);
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

describe('the drift chain as a meter line (playtest 3, T6.3)', () => {
  const drift = (chain: number, cash: number): MeterRun => ({
    kind: 'drift',
    seconds: 0,
    cash,
    qualifies: cash > 0,
    chain,
  });

  it('reads DRIFT with the chain multiplier once it chains, and the unbanked cash beside it', () => {
    expect(meterLabel(drift(1, 90))).toBe('DRIFT');
    expect(meterLabel(drift(2, 140))).toBe('DRIFT ×1.5');
    expect(meterLabel(drift(3, 140))).toBe('DRIFT ×2');
    expect(meterLabel(drift(4, 140))).toBe('DRIFT ×2.5');
    expect(meterLabel(drift(5, 140))).toBe('DRIFT ×3');
    expect(meterLabel(drift(9, 140))).toBe('DRIFT ×3');
    expect(meterCash(drift(3, 140))).toBe('+$140');
  });

  it('keeps the multiplier ladder the sim pays: x1, x1.5, x2, x2.5, then x3 at most', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(driftMultiplier)).toEqual([1, 1, 1.5, 2, 2.5, 3, 3]);
  });
});
