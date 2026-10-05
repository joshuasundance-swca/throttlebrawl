import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
import { createHeadlessRace } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import { createInput, emptyActions, toSimInput } from '../../src/input';
import {
  createSim,
  placeTouchButtons,
  STYLE_KINDS,
  TRICK_IDS,
  type LayoutElement,
  type SimEvent,
  type TouchLayout,
} from '../../src/sim/api';
import { driftChainMult } from '../../src/sim/riders/drift';
import { WHEELIE_LOOP_RAD, WHEELIE_SWEET } from '../../src/sim/riders/wheelie';
import { GAUGE, gaugeView } from '../../src/ui/moves-meter';
import { createRaceTally, driftMultiplier, stylePop } from '../../src/ui/race-feed';
import { ISOLATED } from './batch';

// T6.3's hand-kept copies of the sim's numbers (ui reaches the sim only through sim/api), held to
// the sim here, and the wave A live check's bug class: a move the sim pays that the ticker never
// worded (5 paid wheelies and 5 drift banks gave 0 ticker lines).

const W = 915;
const H = 412;
const MS = 1000 / 60;
/** The Classic preset as the pack ships it: the stick zone and the touch buttons, the wheelie's too. */
const LAYOUT: TouchLayout = {
  id: 'classic',
  mirror: false,
  elements: (classicPreset as unknown as { elements: LayoutElement[] }).elements,
};

class FakeSurface extends EventTarget {
  readonly style = { touchAction: '', pointerEvents: 'none' };
  getBoundingClientRect() {
    return { left: 0, top: 0, width: W, height: H };
  }
  setPointerCapture() {}
}

describe('the HUD copies of the sim numbers', () => {
  it('draws the gauge bands where the sim puts them', () => {
    expect(GAUGE.sweetLoRad).toBe(WHEELIE_SWEET.lo);
    expect(GAUGE.sweetHiRad).toBe(WHEELIE_SWEET.hi);
    expect(GAUGE.loopRad).toBe(WHEELIE_LOOP_RAD);
    expect(GAUGE.maxRad).toBeGreaterThan(WHEELIE_LOOP_RAD);
  });

  it('writes the drift chain multiplier the sim pays', () => {
    for (let chain = 0; chain <= 12; chain++) expect(driftMultiplier(chain)).toBe(driftChainMult(chain));
  });
});

describe('every style kind the sim pays has a ticker word', () => {
  it('words each kind in the sim list, and each trick', () => {
    for (const kind of STYLE_KINDS) {
      if (kind === 'trick') {
        for (const trick of TRICK_IDS)
          expect(
            stylePop({ tick: 1, type: 'style', actor: 0, data: { kind, trick, flips: 1, points: 10 } }),
          ).not.toBeNull();
      } else {
        expect(
          stylePop({ tick: 1, type: 'style', actor: 0, data: { kind, points: 10 } }),
          kind,
        ).not.toBeNull();
      }
    }
  });

  it('puts a real paid wheelie on the ticker and shows it on the gauge while it is up', () => {
    // The real sim: the bot rides to speed, the touch wheelie button (playtest 4) is held for 100
    // ticks, then let go. The wheelie's own style event, passed
    // through the race tally ui/ keeps, is a WHEELIE pop with its cash; and during the hold the
    // gauge's view reads the sim's own snapshot (sweet band, marker at the front's angle).
    const race = createHeadlessRace({ seed: 7, tuning: { ...ISOLATED, 'ai.aggressionScale': 0 } });
    const sim = createSim(race.config);
    const bot = createStubBot();
    for (let t = 0; t < 200; t++) {
      const me = sim.snapshot().entities[race.playerId];
      if (!me) throw new Error('no player');
      const a = emptyActions();
      bot.drive(me, race.route, a);
      sim.step([toSimInput(a)]);
    }
    const surface = new FakeSurface();
    const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT, vibrate: null });
    const button = placeTouchButtons(LAYOUT, W, H).wheelie;
    if (!button) throw new Error('the Classic preset has no wheelie button');
    let tick = 0;
    const bx = button.x + button.w / 2;
    const by = button.y + button.h / 2;
    const fire = (type: string, id: number, x = bx, y = by) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
        timeStamp: { value: tick * MS },
      });
      surface.dispatchEvent(e);
    };
    const events: SimEvent[] = [];
    const step = () => {
      sim.step([input.sample(1 / 60)]);
      tick++;
      events.push(...sim.events());
    };
    // The left thumb holds the stick up (full gas), the right thumb the button.
    fire('pointerdown', 1, 150, 300);
    fire('pointermove', 1, 150, 230);
    fire('pointerdown', 2);
    for (let i = 0; i < 100; i++) step();
    const snap = sim.snapshot();
    const theta = snap.entities[race.playerId]?.wheelie ?? 0;
    const view = gaugeView(snap.moves, theta);
    expect(view.show).toBe(true);
    expect(view.band).toBe('sweet');
    expect(view.marker).toBeCloseTo(theta / GAUGE.maxRad, 5);
    fire('pointerup', 2);
    for (let i = 0; i < 90; i++) step();
    expect(gaugeView(sim.snapshot().moves, sim.snapshot().entities[race.playerId]?.wheelie).show).toBe(false);
    const paid = events.filter((e) => e.type === 'style' && e.data['kind'] === 'wheelie');
    console.log(
      `[examined] real sim: ${paid.length} paid wheelie style event(s), data ${JSON.stringify(paid[0]?.data)}`,
    );
    expect(paid).toHaveLength(1);
    const tally = createRaceTally();
    tally.onEvents(events, race.playerId);
    const pops = tally.takePopups().filter((p) => p.kind === 'wheelie');
    expect(pops).toHaveLength(1);
    expect(pops[0]?.word).toBe('WHEELIE');
    expect(pops[0]?.points).toBeGreaterThan(0);
  });
});
