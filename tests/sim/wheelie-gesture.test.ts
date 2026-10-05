import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
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
import {
  createSim,
  InputFlag,
  placeTouchButtons,
  type LayoutElement,
  type SimEvent,
  type SimInput,
  type TouchLayout,
} from '../../src/sim/api';
import { panelGroups } from '../../src/ui/tuning/model';
import { ISOLATED } from './batch';

// Playtest 4's wheelie button (P4-7, [decided] "Wheelie button") against the real sim: the touch
// button, the H key and the gamepad's R3, through the action state and the quantized SimInput, lift
// the sim's wheelie while held and drop it when released, with the throttle its own. The unit cases
// are in src/input/wheelie-button.test.ts and src/sim/riders/wheelie.test.ts; this proves the two
// halves agree on a real race. Counted in sim ticks, with pointer timestamps taken from them; no wall
// clock.

const SEED = 7;
const DT = 1 / 60;
const MS = 1000 / 60;
/** The bot rides to speed first: the wheelie needs 6 m/s. */
const RIDE_TICKS = 200;

const W = 915;
const H = 412;
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

const blank = (): ActionState => emptyActions();

/**
 * A race with the player ridden to speed by the stub bot, ready to be driven by a device. It races
 * the ISOLATED profile with the rivals' swings off: a kick taken drops a wheelie's front (by the
 * spec), and a test of the button is not a test of that.
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

describe('the wheelie button against the real sim', () => {
  it('puts the gain and the hold lift sliders on the tuning panel the phone opens, and no double-tap ones', () => {
    const placed = panelGroups(APP_TUNING).flatMap((g) =>
      g.controls.map((c) => ({ group: g.group, id: c.decl.id, min: c.decl.min, max: c.decl.max })),
    );
    expect(placed).toContainEqual({ group: 'crashes', id: 'riders.wheelieGain', min: 0.5, max: 2 });
    expect(placed).toContainEqual(expect.objectContaining({ group: 'crashes', id: 'riders.wheelieRise' }));
    expect(placed.some((p) => p.id.startsWith('input.wheelieTap'))).toBe(false);
  });

  it('touch: holding the button lifts it at once and keeps it up, full gas on the stick; letting go drops it cleanly', () => {
    const { race, sim } = ridden();
    const surface = new FakeSurface();
    const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT, vibrate: null });
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
    const button = placeTouchButtons(LAYOUT, W, H).wheelie;
    if (!button) throw new Error('the Classic preset has no wheelie button');
    const bx = button.x + button.w / 2;
    const by = button.y + button.h / 2;

    let tick = 0;
    const events: SimEvent[] = [];
    const step = (): SimInput => {
      const cmd = input.sample(DT);
      sim.step([cmd]);
      events.push(...sim.events());
      tick++;
      return cmd;
    };
    // The left thumb on the stick, all the way up: full throttle, as a racer rides.
    fire('pointerdown', 1, 150, 300, tick);
    fire('pointermove', 1, 150, 230, tick);
    for (let i = 0; i < 10; i++) step();
    expect(bandOf(sim)).toBeNull();
    // The right thumb on the wheelie button.
    fire('pointerdown', 2, bx, by, tick);
    const first = step();
    expect(first.flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
    expect(first.throttle).toBe(255);
    expect(bandOf(sim)).not.toBeNull(); // popped on the very first tick of the press
    for (let i = 0; i < 60; i++) step();
    const theta = sim.snapshot().entities[race.playerId]?.wheelie ?? 0;
    console.log(
      `[examined] touch button held 61 ticks at full gas: θ ${theta.toFixed(3)} rad, band ${String(bandOf(sim))}`,
    );
    expect(bandOf(sim)).toBe('sweet');
    expect(events.filter((e) => e.actor === race.playerId && e.type === 'crash')).toEqual([]);
    // Let go of the button, keep the gas: the front comes down, cleanly.
    fire('pointerup', 2, bx, by, tick);
    let ends: SimEvent[] = [];
    for (let i = 0; i < 90 && ends.length === 0; i++) {
      step();
      ends = events.filter((e) => e.type === 'wheelieEnd' && e.actor === race.playerId);
    }
    expect(ends).toHaveLength(1);
    expect(ends[0]?.data).toMatchObject({ clean: true, loopOut: false });
    expect(bandOf(sim)).toBeNull();
  });

  it('touch: the stick alone, tapped and pressed again in the old rhythm, never lifts the front', () => {
    const { sim } = ridden();
    const surface = new FakeSurface();
    const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT, vibrate: null });
    const fire = (type: string, id: number, x: number, y: number, ms: number) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
        timeStamp: { value: ms },
      });
      surface.dispatchEvent(e);
    };
    let popped = false;
    const run = (n: number) => {
      for (let i = 0; i < n; i++) {
        sim.step([input.sample(DT)]);
        popped ||= bandOf(sim) !== null;
      }
    };
    fire('pointerdown', 1, 150, 300, 0);
    fire('pointerup', 1, 150, 300, 100);
    run(10);
    fire('pointerdown', 2, 150, 264, 200);
    run(60);
    expect(popped).toBe(false);
  });

  it('keyboard: hold H with W held, and the front lifts at once; release H and it comes down', () => {
    const { race, sim } = ridden();
    const kb = new KeyboardState();
    const events: SimEvent[] = [];
    const step = (): SimInput => {
      const a = emptyActions();
      kb.sample(a, DT);
      const cmd = toSimInput(a);
      sim.step([cmd]);
      events.push(...sim.events());
      return cmd;
    };
    kb.down('KeyW');
    for (let i = 0; i < 30; i++) step();
    kb.down('KeyH');
    const first = step();
    expect(first.flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
    expect(sim.snapshot().entities[race.playerId]?.wheelie ?? 0).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) step();
    expect(bandOf(sim)).toBe('sweet');
    kb.up('KeyH');
    for (let i = 0; i < 90; i++) step();
    const end = events.find((e) => e.type === 'wheelieEnd' && e.actor === race.playerId);
    expect(end?.data).toMatchObject({ clean: true, loopOut: false });
  });

  it('gamepad: hold R3 with R2 pulled, and the front lifts at once and stays up', () => {
    const { sim } = ridden();
    const gp = new GamepadState();
    const pad = (r3: boolean): PadLike => ({
      connected: true,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: i === PAD.r2 || (i === PAD.r3 && r3),
        value: i === PAD.r2 || (i === PAD.r3 && r3) ? 1 : 0,
      })),
    });
    const step = (r3: boolean): SimInput => {
      const a = emptyActions();
      gp.sample(a, [pad(r3)], 0.12, DT);
      const cmd = toSimInput(a);
      sim.step([cmd]);
      return cmd;
    };
    for (let i = 0; i < 10; i++) step(false);
    const first = step(true);
    expect(first.flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
    expect(first.throttle).toBe(255);
    expect(bandOf(sim)).not.toBeNull();
    for (let i = 0; i < 60; i++) step(true);
    expect(bandOf(sim)).toBe('sweet');
  });
});
