// Playtest 3's wheelie gesture (task T2.2; docs/architecture.md, "Input"): double-tap the throttle
// to pop it, then balance it by thumb height. Every case is pure: pointer events carry timestamps,
// the keyboard and the gamepad step by dt, and no test waits on a wall clock or a frame count.
import { describe, expect, it } from 'vitest';
import { InputFlag, type SimInput, type TouchLayout } from '../sim/api';
import {
  createInput,
  DEFAULT_KEY_MAP,
  emptyActions,
  GamepadState,
  hapticKind,
  hapticPattern,
  inputDefaults,
  INPUT_TUNING,
  applyInputParam,
  KEY_ACTION_NAMES,
  keyLegend,
  KeyboardState,
  PAD,
  toSimInput,
  type ControlOptions,
  type PadLike,
} from './index';
import { createHaptics } from './feedback';
import { reachesWheelieFloor, WHEELIE_FLOOR } from './devices/wheelie-tap';
import { quantizeInput } from '../sim/api';
import type { SimEvent } from '../sim/api';

const W = 915;
const H = 412;
const DT = 1 / 60;

// The stick zone of the classic HUD layout (packs/base/hud/classic.json), left 90% of the screen.
const LAYOUT: TouchLayout = {
  id: 'test',
  mirror: false,
  elements: [
    {
      element: 'touch-stick-zone',
      visible: true,
      anchor: 'bottom-left',
      offset: [0, 0],
      size: [0.9, 1.0],
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

function setup(controls: Partial<ControlOptions> = {}) {
  const surface = new FakeSurface();
  const input = createInput({ keys: new EventTarget(), surface, layout: LAYOUT, controls });
  const fire = (type: string, id: number, x: number, y: number, t: number) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, {
      pointerId: { value: id },
      clientX: { value: x },
      clientY: { value: y },
      timeStamp: { value: t },
    });
    surface.dispatchEvent(e);
  };
  return { input, fire, sample: (): SimInput => input.sample(DT) };
}

const wheelie = (s: SimInput) => (s.flags & InputFlag.wheelie) !== 0;
/** The throttle the sim will read, 0..1. */
const gas = (s: SimInput) => s.throttle / 255;

// The first tap's base. 60 px is the stick range, so 30 px above it is half throttle.
const BX = 150;
const BY = 300;

/** A first tap at the base: down at t0, up at t0 + 120 ms. */
function firstTap(t: ReturnType<typeof setup>, t0 = 0) {
  t.fire('pointerdown', 1, BX, BY, t0);
  t.fire('pointerup', 1, BX, BY, t0 + 120);
}

describe('wheelie gesture: the throttle floor', () => {
  it('reachesWheelieFloor judges the throttle as the sim reads it after quantization', () => {
    // The sim's own floor, 0.3 (sim/riders/wheelie.ts), is pinned equal in tests/sim/wheelie-gesture.
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const read = quantizeInput({ steer: 0, throttle: t, brake: 0, flags: 0 }).throttle / 255;
      expect(reachesWheelieFloor(t)).toBe(read >= WHEELIE_FLOOR);
    }
    expect(reachesWheelieFloor(0.3)).toBe(true);
    expect(reachesWheelieFloor(0.29)).toBe(false);
    expect(reachesWheelieFloor(2)).toBe(true);
    expect(reachesWheelieFloor(-1)).toBe(false);
  });
});

describe('wheelie gesture, touch: double-tap, then thumb height', () => {
  it('a second press 30 px above the first base pops on its first sample, at half throttle', () => {
    const t = setup();
    firstTap(t); // up at 120
    t.fire('pointerdown', 2, BX, BY - 30, 240); // 120 ms after the lift
    const first = t.sample();
    expect(wheelie(first)).toBe(true);
    expect(first.throttle).toBe(128); // 30 / 60 = 0.5, on the very first sample
    // The base is the first tap's, not the new press's: that is what gives the throttle.
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY });
  });

  it('the thumb height stays the throttle while the press holds, and the flag stays up', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 30, 240);
    expect(wheelie(t.sample())).toBe(true);
    t.fire('pointermove', 2, BX, BY - 40, 260);
    const higher = t.sample();
    expect(wheelie(higher)).toBe(true);
    expect(gas(higher)).toBeCloseTo(40 / 60, 2);
    t.fire('pointermove', 2, BX, BY - 12, 280);
    const lower = t.sample();
    expect(wheelie(lower)).toBe(true); // the sim ignores the flag while the front is up
    expect(gas(lower)).toBeCloseTo(12 / 60, 2);
  });

  it('lifting the thumb clears the flag and the throttle: lift is coast', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 30, 240);
    t.sample();
    t.fire('pointerup', 2, BX, BY - 30, 600);
    const after = t.sample();
    expect(wheelie(after)).toBe(false);
    expect(after.throttle).toBe(0);
    expect(t.input.stickBase()).toBeNull();
  });

  it('a second tap after the window behaves as today: a new base, no wheelie', () => {
    const t = setup();
    firstTap(t); // up at 120
    t.fire('pointerdown', 2, BX, BY - 30, 420); // 300 ms after the lift, over the 280 ms window
    const s = t.sample();
    expect(wheelie(s)).toBe(false);
    expect(s.throttle).toBe(0); // the stick spawned under the thumb
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY - 30 });
  });

  it('a second tap 150 px away is not a wheelie, and the stick spawns under it', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX + 150, BY, 240);
    const s = t.sample();
    expect(wheelie(s)).toBe(false);
    expect(t.input.stickBase()).toEqual({ x: BX + 150, y: BY });
  });

  it('a second tap 80 px away still counts (the radius is 90 px)', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX + 80, BY, 240);
    t.sample();
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY });
  });

  it('a long first press is a ride, not a tap: lifting and re-gripping does not pop', () => {
    const t = setup();
    t.fire('pointerdown', 1, BX, BY, 0);
    t.fire('pointermove', 1, BX, BY - 40, 100);
    t.sample();
    t.fire('pointerup', 1, BX, BY - 40, 900); // held 900 ms
    t.fire('pointerdown', 2, BX, BY - 40, 960); // a re-grip 60 ms later, where the thumb was
    const s = t.sample();
    expect(wheelie(s)).toBe(false);
    expect(s.throttle).toBe(0); // a new base under the thumb, as today
  });

  it('a second press that has not reached the 0.3 floor pops when the thumb slides past it', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 4, 240); // just above the base: 4 / 60 of the throttle
    expect(wheelie(t.sample())).toBe(false);
    t.fire('pointermove', 2, BX, BY - 10, 260);
    expect(wheelie(t.sample())).toBe(false);
    t.fire('pointermove', 2, BX, BY - 20, 280); // 0.33
    const popped = t.sample();
    expect(wheelie(popped)).toBe(true);
    expect(gas(popped)).toBeGreaterThanOrEqual(0.3);
  });

  it('the flag never rises with less than the sim reads as 0.3, at any thumb height', () => {
    let rose = 0;
    for (let px = 0; px <= 60; px += 0.5) {
      const t = setup();
      firstTap(t);
      t.fire('pointerdown', 2, BX, BY - px, 240);
      const s = t.sample();
      if (wheelie(s)) {
        rose++;
        expect(gas(s)).toBeGreaterThanOrEqual(0.3);
      } else expect(gas(s)).toBeLessThan(0.3);
    }
    expect(rose).toBeGreaterThan(50); // it did rise over the upper range, so the check could fail
  });

  it('a press and lift between two samples sets nothing', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 30, 240);
    t.fire('pointerup', 2, BX, BY - 30, 250);
    expect(wheelie(t.sample())).toBe(false);
  });

  it('a quick triple tap pops again from the same base', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 30, 240);
    t.sample();
    t.fire('pointerup', 2, BX, BY - 30, 360); // a 120 ms press: itself a tap
    t.fire('pointerdown', 3, BX, BY - 30, 480);
    expect(wheelie(t.sample())).toBe(true);
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY });
  });

  it('input.wheelieTapMs and input.wheelieTapPx move the window and the radius', () => {
    const narrow = setup();
    narrow.input.setParam('input.wheelieTapMs', 150);
    firstTap(narrow); // up at 120
    narrow.fire('pointerdown', 2, BX, BY - 30, 340); // 220 ms after the lift
    expect(wheelie(narrow.sample())).toBe(false);

    const wide = setup();
    wide.input.setParam('input.wheelieTapMs', 400);
    firstTap(wide);
    wide.fire('pointerdown', 2, BX, BY - 30, 440); // 320 ms after the lift
    expect(wheelie(wide.sample())).toBe(true);

    const close = setup();
    close.input.setParam('input.wheelieTapPx', 40);
    firstTap(close);
    close.fire('pointerdown', 2, BX + 60, BY, 240); // 60 px away
    expect(wheelie(close.sample())).toBe(false);
  });

  it('the stick still steers and the dead zone still holds on a re-used base', () => {
    const t = setup();
    firstTap(t);
    t.fire('pointerdown', 2, BX + 45, BY - 30, 240);
    const s = t.sample();
    expect(wheelie(s)).toBe(true);
    expect(s.steer).toBeGreaterThan(0);
  });

  it('losing the window (blur) forgets the first tap', () => {
    const surface = new FakeSurface();
    const keys = new EventTarget();
    const input = createInput({ keys, surface, layout: LAYOUT });
    const fire = (type: string, id: number, x: number, y: number, ts: number) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
        timeStamp: { value: ts },
      });
      surface.dispatchEvent(e);
    };
    fire('pointerdown', 1, BX, BY, 0);
    fire('pointerup', 1, BX, BY, 120);
    keys.dispatchEvent(new Event('blur'));
    fire('pointerdown', 2, BX, BY - 30, 240);
    expect(wheelie(input.sample(DT))).toBe(false);
  });

  it('auto-throttle holds full gas, which loops a wheelie out, so the gesture is off under it', () => {
    const t = setup({ autoThrottle: true });
    firstTap(t);
    t.fire('pointerdown', 2, BX, BY - 30, 240);
    const s = t.sample();
    expect(wheelie(s)).toBe(false);
    expect(s.throttle).toBe(255);
  });

  it('the bot driver is untouched: its wheelie reaches the sim, and no device gesture leaks in', () => {
    const t = setup();
    t.input.setDriver((a) => {
      a.throttle = 0.6;
      a.wheelie = true;
    });
    const s = t.sample();
    expect(wheelie(s)).toBe(true);
    expect(gas(s)).toBeCloseTo(0.6, 2);
  });
});

describe('wheelie gesture: stickBase()', () => {
  it('is null with no thumb down, the stick base while one is down, and null after the lift', () => {
    const t = setup();
    expect(t.input.stickBase()).toBeNull();
    t.fire('pointerdown', 1, BX, BY, 0);
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY });
    t.fire('pointermove', 1, BX + 20, BY - 50, 30);
    expect(t.input.stickBase()).toEqual({ x: BX, y: BY }); // the base does not follow the thumb
    t.fire('pointerup', 1, BX + 20, BY - 50, 60);
    expect(t.input.stickBase()).toBeNull();
  });

  it('is clamped one stick radius from the screen edge, as the stick is', () => {
    const t = setup();
    t.fire('pointerdown', 1, 40, 20, 0);
    expect(t.input.stickBase()).toEqual({ x: 60, y: 60 });
  });
});

/** Steps a keyboard `n` ticks, returning each tick's action state. */
function stepKeys(kb: KeyboardState, n: number) {
  return Array.from({ length: n }, () => {
    const a = emptyActions();
    kb.sample(a, DT);
    return a;
  });
}

describe('wheelie gesture, keyboard: tap W, then hold W', () => {
  /** A short tap of `key`, then `gap` ticks of nothing. */
  const tap = (kb: KeyboardState, key = 'KeyW', hold = 6, gap = 3) => {
    kb.down(key);
    stepKeys(kb, hold);
    kb.up(key);
    stepKeys(kb, gap);
  };

  it('a tap and a hold sets the wheelie bit once the throttle has ramped past 0.3', () => {
    const kb = new KeyboardState();
    tap(kb);
    kb.down('KeyW');
    const held = stepKeys(kb, 12);
    // The throttle ramps in 1/3 s: 0.05 a tick, so it is under 0.3 for the first five samples.
    expect(held.slice(0, 5).some((a) => a.wheelie)).toBe(false);
    const first = held.findIndex((a) => a.wheelie);
    expect(first).toBeGreaterThanOrEqual(5);
    expect(first).toBeLessThanOrEqual(6);
    expect(toSimInput(held[first]!).throttle / 255).toBeGreaterThanOrEqual(0.3);
    for (const a of held.slice(first))
      expect(toSimInput(a).flags & InputFlag.wheelie).toBe(InputFlag.wheelie);
  });

  it('releasing W clears it', () => {
    const kb = new KeyboardState();
    tap(kb);
    kb.down('KeyW');
    stepKeys(kb, 12);
    kb.up('KeyW');
    expect(stepKeys(kb, 1)[0]!.wheelie).toBeFalsy();
  });

  it('a lone hold of W is a ride, with no wheelie, however long', () => {
    const kb = new KeyboardState();
    kb.down('KeyW');
    expect(stepKeys(kb, 90).some((a) => a.wheelie)).toBe(false);
  });

  it('a second press after the window (more than 280 ms) is a plain ride', () => {
    const kb = new KeyboardState();
    tap(kb, 'KeyW', 6, 20); // 20 ticks, 333 ms, between the lift and the press
    kb.down('KeyW');
    expect(stepKeys(kb, 30).some((a) => a.wheelie)).toBe(false);
  });

  it('a long first hold is a ride: lifting W for a corner and pressing it again does not pop', () => {
    const kb = new KeyboardState();
    tap(kb, 'KeyW', 40, 3); // held 667 ms, up for 50 ms
    kb.down('KeyW');
    expect(stepKeys(kb, 30).some((a) => a.wheelie)).toBe(false);
  });

  it('either throttle key makes the pair, and key auto-repeat is not a press', () => {
    const kb = new KeyboardState();
    tap(kb, 'KeyW');
    kb.down('ArrowUp');
    kb.down('ArrowUp'); // auto-repeat
    kb.down('ArrowUp');
    expect(stepKeys(kb, 12).some((a) => a.wheelie)).toBe(true);
  });

  it('S, the brake, is not a throttle: a tap of S then W is no pair', () => {
    const kb = new KeyboardState();
    tap(kb, 'KeyS');
    kb.down('KeyW');
    expect(stepKeys(kb, 12).some((a) => a.wheelie)).toBe(false);
  });

  it('the window follows the thresholds it is given (input.wheelieTapMs)', () => {
    const t = { ...inputDefaults(), wheelieTapMs: 100 };
    const kb = new KeyboardState(DEFAULT_KEY_MAP, t);
    tap(kb, 'KeyW', 3, 9); // a 50 ms tap, then 150 ms between the lift and the press
    kb.down('KeyW');
    expect(stepKeys(kb, 12).some((a) => a.wheelie)).toBe(false);
  });

  it('the legend says double-tap, on the one throttle row', () => {
    expect(KEY_ACTION_NAMES.throttle).toBe('ride (double-tap: wheelie)');
    const row = keyLegend().find((r) => r.action === KEY_ACTION_NAMES.throttle);
    expect(row?.keys).toBe('W / ↑');
  });
});

/** A standard-mapping pad with R2 (the throttle) at `r2`, 0..1. */
function padAt(r2: number): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => ({
    pressed: i === PAD.r2 && r2 >= 0.5,
    value: i === PAD.r2 ? r2 : 0,
  }));
  return { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
}

describe('wheelie gesture, gamepad: pull R2 twice, the depth is the balance', () => {
  const run = (gp: GamepadState, r2: number, n: number) =>
    Array.from({ length: n }, () => {
      const a = emptyActions();
      gp.sample(a, [padAt(r2)], 0.12, DT);
      return a;
    });

  it('a second pull of R2 past 0.5 within 280 ms of dropping under 0.2 pops at that depth', () => {
    const gp = new GamepadState();
    run(gp, 1, 5);
    run(gp, 0, 4); // 67 ms with the trigger up
    const pull = run(gp, 0.7, 3);
    expect(pull[0]!.wheelie).toBe(true);
    expect(pull[0]!.throttle).toBeCloseTo(0.7, 6);
  });

  it('the depth of R2 balances it: shallower than 0.5 holds the flag, under 0.2 lets go', () => {
    const gp = new GamepadState();
    run(gp, 1, 5);
    run(gp, 0, 4);
    run(gp, 0.7, 3);
    expect(run(gp, 0.4, 3).every((a) => a.wheelie)).toBe(true);
    expect(run(gp, 0.1, 1)[0]!.wheelie).toBeFalsy();
  });

  it('a pull after the window, or after a long first pull, is a plain throttle', () => {
    const late = new GamepadState();
    run(late, 1, 5);
    run(late, 0, 20); // 333 ms
    expect(run(late, 0.7, 6).some((a) => a.wheelie)).toBe(false);

    const longHold = new GamepadState();
    run(longHold, 1, 40); // held 667 ms
    run(longHold, 0, 3);
    expect(run(longHold, 0.7, 6).some((a) => a.wheelie)).toBe(false);
  });

  it('a lone pull, and a press that never passes 0.5, set nothing', () => {
    const gp = new GamepadState();
    expect(run(gp, 1, 30).some((a) => a.wheelie)).toBe(false);
    const soft = new GamepadState();
    run(soft, 1, 5);
    run(soft, 0, 4);
    expect(run(soft, 0.45, 10).some((a) => a.wheelie)).toBe(false);
  });
});

describe('wheelie gesture: tuning and feedback', () => {
  it('declares the tap window and radius as input tuning, off the sim', () => {
    const ms = INPUT_TUNING.find((d) => d.id === 'input.wheelieTapMs');
    const px = INPUT_TUNING.find((d) => d.id === 'input.wheelieTapPx');
    expect(ms).toMatchObject({ default: 280, min: 150, max: 400, unit: 'ms', affectsSim: false });
    expect(px).toMatchObject({ default: 90, min: 40, max: 160, unit: 'px', affectsSim: false });
    const t = inputDefaults();
    expect(t.wheelieTapMs).toBe(280);
    expect(t.wheelieTapPx).toBe(90);
    expect(applyInputParam(t, 'input.wheelieTapMs', 200)).toBe(true);
    expect(t.wheelieTapMs).toBe(200);
  });

  it('a loop-out buzzes the crash pattern, through the crash event and through wheelieEnd', () => {
    const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}): SimEvent =>
      ({ type, actor, data, tick: 1, id: 1 }) as unknown as SimEvent;
    expect(hapticKind(ev('crash', 0, { cause: 'wheelie', loopOut: true }), 0)).toBe('crash');
    expect(hapticKind(ev('wheelieEnd', 0, { loopOut: true }), 0)).toBe('crash');
    expect(hapticKind(ev('wheelieEnd', 0, { loopOut: false, clean: true }), 0)).toBeNull();
    expect(hapticKind(ev('wheelieEnd', 4, { loopOut: true }), 0)).toBeNull();
  });

  it('the gesture ticks 12 ms when it pops, and the band turning high buzzes 30 ms', () => {
    const buzzes: (number | number[])[] = [];
    const h = createHaptics({
      vibrate: (p) => {
        buzzes.push(p);
        return true;
      },
      now: () => 0,
    });
    expect(hapticPattern('wheelieStart')).toEqual([12]);
    expect(hapticPattern('wheelieHigh')).toEqual([30]);
    h.pulse('wheelieStart');
    expect(buzzes).toEqual([[12]]);

    buzzes.length = 0;
    expect(h.onMoves({ wheelieBand: 'low' }, 1000)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'sweet' }, 1100)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'high' }, 1200)).toBe('wheelieHigh');
    expect(h.onMoves({ wheelieBand: 'high' }, 1300)).toBeNull(); // once per turn, not every tick
    expect(h.onMoves({ wheelieBand: 'sweet' }, 1400)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'high' }, 1500)).toBe('wheelieHigh');
    expect(h.onMoves(null, 1600)).toBeNull();
    expect(buzzes).toEqual([[30], [30]]);
  });

  it('a wheelie tick does not cut into a crash buzz still playing', () => {
    const buzzes: (number | number[])[] = [];
    const h = createHaptics({
      vibrate: (p) => {
        buzzes.push(p);
        return true;
      },
      now: () => 0,
    });
    const crash = { type: 'crash', actor: 0, data: {} } as unknown as SimEvent;
    expect(h.onEvents([crash], 0, 0)).toBe('crash');
    h.onMoves({ wheelieBand: 'high' }, 50); // inside the crash's 220 ms
    expect(buzzes).toEqual([[120, 40, 60]]);
  });

  it('the input system feeds the moves in, and respects the haptics switch', () => {
    const buzzes: (number | number[])[] = [];
    const surface = new FakeSurface();
    const input = createInput({
      keys: new EventTarget(),
      surface,
      layout: LAYOUT,
      vibrate: (p) => {
        buzzes.push(p);
        return true;
      },
    });
    input.onMoves({ wheelieBand: 'sweet' });
    input.onMoves({ wheelieBand: 'high' });
    expect(buzzes).toEqual([[30]]);
    input.setOptions({ haptics: false }); // switching off stops the buzz still playing (vibrate(0))
    const quiet = buzzes.length;
    input.onMoves({ wheelieBand: 'sweet' });
    input.onMoves({ wheelieBand: 'high' });
    expect(buzzes).toHaveLength(quiet);
  });

  it('popping the gesture on a phone ticks once, on the rising sample', () => {
    const buzzes: (number | number[])[] = [];
    const surface = new FakeSurface();
    const input = createInput({
      keys: new EventTarget(),
      surface,
      layout: LAYOUT,
      vibrate: (p) => {
        buzzes.push(p);
        return true;
      },
    });
    const fire = (type: string, id: number, x: number, y: number, ts: number) => {
      const e = new Event(type, { cancelable: true });
      Object.defineProperties(e, {
        pointerId: { value: id },
        clientX: { value: x },
        clientY: { value: y },
        timeStamp: { value: ts },
      });
      surface.dispatchEvent(e);
    };
    fire('pointerdown', 1, BX, BY, 0);
    fire('pointerup', 1, BX, BY, 120);
    input.sample(DT);
    expect(buzzes).toEqual([]); // the first tap is just a tap
    fire('pointerdown', 2, BX, BY - 30, 240);
    for (let i = 0; i < 5; i++) input.sample(DT);
    expect(buzzes).toEqual([[12]]);
  });
});
