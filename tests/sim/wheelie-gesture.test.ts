import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { APP_TUNING } from '../../src/app/tuning';
import { createStubBot } from '../../src/dev/bot';
import {
  createInput,
  emptyActions,
  GamepadState,
  KeyboardState,
  PAD,
  toSimInput,
  type PadLike,
} from '../../src/input';
import { reachesWheelieFloor, WHEELIE_FLOOR } from '../../src/input/devices/wheelie-tap';
import { createSim, InputFlag, quantizeInput, type SimEvent, type SimInput } from '../../src/sim/api';
import { WHEELIE_MIN_THROTTLE } from '../../src/sim/riders/wheelie';
import { panelGroups } from '../../src/ui/tuning/model';
import { ISOLATED } from './batch';

// Playtest 3's wheelie gesture against the real sim (task T2.2): the devices' double-tap, through
// the action state and the quantized SimInput, pops the sim's wheelie, and the thumb's height is the
// balance. The unit cases are in src/input/wheelie-tap.test.ts; this proves the two halves agree,
// above all on the 0.3 throttle floor: a flag the input raises is a pop the sim accepts. Counted in
// sim ticks, with pointer timestamps taken from them; no wall clock.

const SEED = 7;
const DT = 1 / 60;
const MS = 1000 / 60;
/** The bot rides to speed first: the wheelie needs 6 m/s. */
const RIDE_TICKS = 200;

const W = 915;
const H = 412;
const LAYOUT = {
  id: 'test',
  mirror: false,
  elements: [
    {
      element: 'touch-stick-zone',
      visible: true,
      anchor: 'bottom-left' as const,
      offset: [0, 0] as [number, number],
      size: [0.9, 1.0] as [number, number],
      scale: 1,
      opacity: 0,
    },
  ],
};

class FakeSurface extends EventTarget {
  readonly style = { touchAction: '', pointerEvents: 'none' };
  getBoundingClientRect() {
    return { left: 0, top: 0, width: W, height: H };
  }
  setPointerCapture() {}
}

const blank = (): ActionState => emptyActions();

/**
 * A race with the player ridden to speed by the stub bot, ready to be driven by a device. It races
 * the ISOLATED profile with the rivals' swings off: a kick taken drops a wheelie's front (by the
 * spec), and a test of the gesture is not a test of that.
 */
function ridden() {
  const race = createHeadlessRace({ seed: SEED, tuning: { ...ISOLATED, 'ai.aggressionScale': 0 } });
  const sim = createSim(race.config);
  const bot = createStubBot();
  for (let t = 0; t < RIDE_TICKS; t++) {
    const me = sim.snapshot().entities[race.playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, race.route, a);
    sim.step([toSimInput(a)]);
  }
  return { race, sim };
}

function bandOf(sim: ReturnType<typeof createSim>) {
  return sim.snapshot().moves?.wheelieBand ?? null;
}

const eventsOf = (sim: ReturnType<typeof createSim>, type: SimEvent['type']) =>
  sim.events().filter((e) => e.type === type);

describe('the wheelie gesture against the real sim', () => {
  it('keeps the input floor equal to the sim floor', () => {
    expect(WHEELIE_FLOOR).toBe(WHEELIE_MIN_THROTTLE);
  });

  it('puts the gain slider and the two double-tap sliders on the tuning panel the phone opens', () => {
    // The sweet band is a few pixels of thumb (moves.md, risk 1): the slider that widens it must be
    // reachable. Found the way the panel is built, from the registry's own declarations.
    const placed = panelGroups(APP_TUNING).flatMap((g) =>
      g.controls.map((c) => ({ group: g.group, id: c.decl.id, min: c.decl.min, max: c.decl.max })),
    );
    expect(placed).toContainEqual({ group: 'crashes', id: 'riders.wheelieGain', min: 0.5, max: 2 });
    expect(placed).toContainEqual({ group: 'controls', id: 'input.wheelieTapMs', min: 150, max: 400 });
    expect(placed).toContainEqual({ group: 'controls', id: 'input.wheelieTapPx', min: 40, max: 160 });
  });

  it('touch: a double-tap pops it, the thumb height balances it, a lift lets it down cleanly', () => {
    const { race, sim } = ridden();
    const surface = new FakeSurface();
    const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT });
    const fire = (type: string, id: number, x: number, y: number, tick: number) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
        timeStamp: { value: tick * MS },
      });
      surface.dispatchEvent(e);
    };
    const speed = sim.snapshot().entities[race.playerId]?.speed ?? 0;
    expect(speed).toBeGreaterThan(6);

    let tick = 0;
    const step = (): SimInput => {
      const cmd = input.sample(DT);
      sim.step([cmd]);
      tick++;
      return cmd;
    };
    // The first tap, a short press at the base. Its throttle is a blip of nothing.
    fire('pointerdown', 1, 150, 300, tick);
    for (let i = 0; i < 6; i++) step();
    fire('pointerup', 1, 150, 300, tick);
    for (let i = 0; i < 4; i++) step();
    expect(bandOf(sim)).toBeNull();
    // The second press, 36 px above the first base: 0.6 of the stick, the sweet band's middle.
    fire('pointerdown', 2, 150, 264, tick);
    const popTick = tick;
    const first = step();
    expect(first.flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
    expect(first.throttle / 255).toBeGreaterThanOrEqual(WHEELIE_MIN_THROTTLE);
    expect(bandOf(sim)).not.toBeNull(); // popped on the very first tick of the press
    for (let i = 0; i < 100; i++) step();
    const theta = sim.snapshot().entities[race.playerId]?.wheelie ?? 0;
    console.log(`[examined] touch double-tap at tick ${popTick}: θ ${theta.toFixed(3)} rad after 100 ticks`);
    expect(bandOf(sim)).toBe('sweet');
    expect(Math.abs(theta - 0.6)).toBeLessThan(0.1);
    // Lift: coast, and the front comes down cleanly.
    fire('pointerup', 2, 150, 264, tick);
    const ends: SimEvent[] = [];
    for (let i = 0; i < 90; i++) {
      step();
      ends.push(...eventsOf(sim, 'wheelieEnd'));
    }
    expect(ends).toHaveLength(1);
    expect(ends[0]?.data).toMatchObject({ clean: true, loopOut: false });
    expect(bandOf(sim)).toBeNull();
  });

  it('touch: a lone press at the same height does nothing', () => {
    const { sim } = ridden();
    const surface = new FakeSurface();
    const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT });
    const e = new Event('pointerdown', { cancelable: true });
    Object.defineProperties(e, {
      pointerId: { value: 1 },
      clientX: { value: 150 },
      clientY: { value: 300 },
      timeStamp: { value: 0 },
    });
    surface.dispatchEvent(e);
    let popped = false;
    for (let i = 0; i < 60; i++) {
      sim.step([input.sample(DT)]);
      popped ||= bandOf(sim) !== null;
    }
    expect(popped).toBe(false);
  });

  it('keyboard: tap W, then hold W, pops it as the ramp passes 0.3', () => {
    const { race, sim } = ridden();
    const kb = new KeyboardState();
    const step = (): SimInput => {
      const a = emptyActions();
      kb.sample(a, DT);
      const cmd = toSimInput(a);
      sim.step([cmd]);
      return cmd;
    };
    kb.down('KeyW');
    for (let i = 0; i < 6; i++) step();
    kb.up('KeyW');
    for (let i = 0; i < 3; i++) step();
    kb.down('KeyW');
    let pop = -1;
    for (let i = 0; i < 12; i++) {
      const cmd = step();
      if (pop < 0 && cmd.flags & InputFlag.wheelie) {
        pop = i;
        // The same tick the input raises the flag, the sim takes it.
        expect(cmd.throttle / 255).toBeGreaterThanOrEqual(WHEELIE_MIN_THROTTLE);
        expect(bandOf(sim)).not.toBeNull();
        expect(sim.snapshot().entities[race.playerId]?.wheelie ?? 0).toBeGreaterThan(0);
      }
    }
    console.log(`[examined] keyboard double-tap: the flag rose on ramp tick ${pop}`);
    expect(pop).toBeGreaterThanOrEqual(5);
    expect(pop).toBeLessThanOrEqual(6);
  });

  it('gamepad: pull R2 twice, and the second pull pops it at that depth', () => {
    const { sim } = ridden();
    const gp = new GamepadState();
    const pad = (r2: number): PadLike => ({
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: i === PAD.r2 && r2 >= 0.5,
        value: i === PAD.r2 ? r2 : 0,
      })),
    });
    const step = (r2: number): SimInput => {
      const a = emptyActions();
      gp.sample(a, [pad(r2)], 0.12, DT);
      const cmd = toSimInput(a);
      sim.step([cmd]);
      return cmd;
    };
    for (let i = 0; i < 5; i++) step(1);
    for (let i = 0; i < 4; i++) step(0);
    const first = step(0.6);
    expect(first.flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
    expect(bandOf(sim)).not.toBeNull();
    for (let i = 0; i < 100; i++) step(0.6);
    expect(bandOf(sim)).toBe('sweet');
  });

  it('every flag the quantized input raises is a pop the sim accepts, at the floor and above', () => {
    // The floor, probed at its edge: 76 of 255 reads as 0.298 and is refused, 77 reads as 0.302 and
    // pops. The input raises the flag only from 77 up (reachesWheelieFloor), so none is ever wasted.
    const popped = (q: number): boolean => {
      const { sim } = ridden();
      sim.step([quantizeInput({ steer: 0, throttle: q / 255, brake: 0, flags: InputFlag.wheelie })]);
      return bandOf(sim) !== null;
    };
    const results = [0, 50, 75, 76, 77, 78, 128, 255].map((q) => [q, popped(q)] as const);
    console.log(`[examined] pop by quantized throttle: ${JSON.stringify(results)}`);
    expect(results.filter(([, p]) => p).map(([q]) => q)).toEqual([77, 78, 128, 255]);
    for (const [q, p] of results) expect(p).toBe(reachesWheelieFloor(q / 255));
  });
});
