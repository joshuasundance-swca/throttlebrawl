import { describe, expect, it } from 'vitest';
import type { SimEvent } from '../sim/api';
import { createRaceTally, styleText } from './race-feed';
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
    expect(pops).toEqual(['NEAR MISS +$50']);
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
