// input-2 unit acceptance (docs/milestones/M2.md, "input-2"): the gamepad, tilt, haptics,
// auto-throttle and pull-back brake, driven through createInput where the path is createInput's.
import { describe, expect, it, vi } from 'vitest';
import { InputFlag, placeElement, type SimEvent, type SimInput, type TouchLayout } from '../sim/api';
import {
  createHaptics,
  createInput,
  DEFAULT_CONTROL_OPTIONS,
  DEFAULT_PAD_MAP,
  hapticKind,
  INPUT_TUNING,
  inputDefaults,
  PAD,
  padMapFromBindings,
  tiltAngleFromEuler,
  tiltAngleFromGravity,
  TiltState,
  type ControlOptions,
  type PadLike,
} from './index';

const W = 915;
const H = 412;
const DT = 1 / 60;
const has = (s: SimInput, flag: keyof typeof InputFlag) => (s.flags & InputFlag[flag]) !== 0;

const LAYOUT: TouchLayout = {
  id: 'test',
  mirror: false,
  elements: [
    {
      element: 'touch-attack',
      visible: true,
      anchor: 'bottom-right',
      offset: [0.08, 0.1],
      scale: 1.2,
      opacity: 0.7,
    },
    {
      element: 'touch-brake',
      visible: true,
      anchor: 'bottom-right',
      offset: [0.4, 0.06],
      scale: 0.9,
      opacity: 0.7,
    },
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
}

/** A mutable standard-mapping pad: 17 buttons, 4 axes. */
function pad(): PadLike & {
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
  press(i: number, v?: number): void;
  release(i: number): void;
} {
  const p = {
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    press(i: number, v = 1) {
      p.buttons[i] = { pressed: v >= 0.5, value: v };
    },
    release(i: number) {
      p.buttons[i] = { pressed: false, value: 0 };
    },
  };
  return p;
}

function setup(extra: { pads?: PadLike[]; controls?: Partial<ControlOptions>; screenAngle?: number } = {}) {
  const surface = new FakeSurface();
  const keys = new EventTarget();
  const vibrate = vi.fn((_p: number | number[]) => true);
  let angle = extra.screenAngle ?? 90;
  const input = createInput({
    keys,
    surface,
    layout: LAYOUT,
    gamepads: () => extra.pads ?? [],
    vibrate,
    screenAngle: () => angle,
    ...(extra.controls ? { controls: extra.controls } : {}),
  });
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
  const motion = (g: { x: number; y: number; z: number }) => {
    const e = new Event('devicemotion');
    Object.defineProperty(e, 'accelerationIncludingGravity', { value: g });
    keys.dispatchEvent(e);
  };
  const orientation = (beta: number, gamma: number) => {
    const e = new Event('deviceorientation');
    Object.defineProperties(e, { beta: { value: beta }, gamma: { value: gamma } });
    keys.dispatchEvent(e);
  };
  return {
    input,
    fire,
    motion,
    orientation,
    vibrate,
    setAngle: (a: number) => (angle = a),
    sample: (): SimInput => input.sample(DT),
  };
}

function center(element: string): [number, number] {
  const el = LAYOUT.elements.find((e) => e.element === element);
  if (!el) throw new Error(element);
  const r = placeElement(el, W, H, false);
  return [r.x + r.w / 2, r.y + r.h / 2];
}

/**
 * The gravity reading (the reaction, pointing up) of a phone at screen orientation `a`, held
 * pitched back by `pitch` degrees from upright and turned clockwise by `steer` degrees as the
 * player sees it.
 */
function gravity(a: number, pitch: number, steer: number) {
  const rad = Math.PI / 180;
  const [ca, sa, cp, sp, ct, st] = [
    Math.cos(a * rad),
    Math.sin(a * rad),
    Math.cos(pitch * rad),
    Math.sin(pitch * rad),
    Math.cos(steer * rad),
    Math.sin(steer * rad),
  ];
  // Screen-up u = (sin a, cos a, 0) and screen-right r = (cos a, -sin a, 0) in device axes.
  const up = [cp * (ct * sa - st * ca), cp * (ct * ca + st * sa), sp];
  return { x: 9.81 * up[0]!, y: 9.81 * up[1]!, z: 9.81 * up[2]! };
}

describe('input-2: gamepad', () => {
  it('a mocked Gamepad API drives the action map to the expected SimInput, including a kick', () => {
    const p = pad();
    const { sample } = setup({ pads: [p] });
    p.axes[0] = 1;
    p.press(PAD.r2, 0.6);
    let s = sample();
    expect(s.steer).toBe(127);
    expect(s.throttle).toBe(Math.round(0.6 * 255));
    expect(s.flags).toBe(0);

    p.axes[0] = 0;
    p.release(PAD.r2);
    p.press(PAD.l2);
    s = sample();
    expect(s.brake).toBe(255);
    expect(s.throttle).toBe(0);

    // Triangle: an attack press with the kick flag, held while the button is.
    p.release(PAD.l2);
    p.press(PAD.triangle);
    s = sample();
    expect(has(s, 'attack') && has(s, 'kick')).toBe(true);
    s = sample();
    expect(has(s, 'attack')).toBe(false);
    expect(has(s, 'kick')).toBe(true);
    p.release(PAD.triangle);
    expect(sample().flags).toBe(0);
  });

  it('Cross attacks once per press with the auto side; Square and Circle force the side; R1 looks back', () => {
    const p = pad();
    const { sample } = setup({ pads: [p] });
    p.press(PAD.cross);
    const held = [sample(), sample(), sample()];
    expect(held.filter((s) => has(s, 'attack'))).toHaveLength(1);
    expect(has(held[0]!, 'attackSideLeft') || has(held[0]!, 'attackSideRight')).toBe(false);
    expect(has(held[0]!, 'skipRunBack')).toBe(true);
    p.release(PAD.cross);
    p.press(PAD.square);
    let s = sample();
    expect(has(s, 'attack') && has(s, 'attackSideLeft')).toBe(true);
    p.release(PAD.square);
    p.press(PAD.circle);
    s = sample();
    expect(has(s, 'attack') && has(s, 'attackSideRight')).toBe(true);
    p.release(PAD.circle);
    p.press(PAD.r1);
    expect(sample().flags).toBe(InputFlag.lookBack);
  });

  it('the stick dead zone is 0.12 and radial, and a non-default value changes it', () => {
    const p = pad();
    const { input, sample } = setup({ pads: [p] });
    expect(inputDefaults().gamepadDeadZone).toBe(0.12);
    p.axes[0] = 0.1;
    expect(sample().steer).toBe(0);
    p.axes[0] = 0.56; // (0.56 - 0.12) / 0.88 = 0.5 of full steer
    expect(sample().steer).toBe(Math.round(0.5 * 127));
    input.setParam('input.gamepadDeadZone', 0.3);
    p.axes[0] = 0.2;
    expect(sample().steer).toBe(0);
    p.axes[0] = -1;
    expect(sample().steer).toBe(-127);
  });

  it('the d-pad steers digitally; a disconnected pad and missing buttons are ignored', () => {
    const p = pad();
    const gone = { ...pad(), connected: false };
    gone.axes[0] = 1;
    const { sample } = setup({ pads: [p, gone] });
    expect(sample().steer).toBe(0);
    p.press(PAD.dpadLeft);
    expect(sample().steer).toBe(-127);
    const stub: PadLike = { connected: true, mapping: '', axes: [], buttons: [] };
    expect(setup({ pads: [stub] }).sample().flags).toBe(0);
  });

  it('bindings are remappable', () => {
    const p = pad();
    const surface = new FakeSurface();
    const input = createInput({
      keys: new EventTarget(),
      surface,
      layout: LAYOUT,
      gamepads: () => [p],
      vibrate: null,
      padMap: { ...DEFAULT_PAD_MAP, buttons: { ...DEFAULT_PAD_MAP.buttons, kick: [PAD.l1] } },
    });
    p.press(PAD.triangle);
    expect(has(input.sample(DT), 'kick')).toBe(false);
    p.release(PAD.triangle);
    p.press(PAD.l1);
    expect(has(input.sample(DT), 'kick')).toBe(true);
  });

  it('the bot driver replaces the pad too', () => {
    const p = pad();
    const { input, sample } = setup({ pads: [p] });
    p.axes[0] = 1;
    input.setDriver((a) => {
      a.throttle = 1;
    });
    const s = sample();
    expect(s.steer).toBe(0);
    expect(s.throttle).toBe(255);
  });

  it('saved remaps (settings gamepadBindings tokens) rebind buttons and the steer axis', () => {
    const map = padMapFromBindings({
      kick: ['button4'],
      lookBack: ['button5', 'button7'],
      steer: ['axis2'],
      attack: ['bogus', 'button99'], // no valid token: keeps its default
      notAnAction: ['button1'],
    });
    expect(map.buttons.kick).toEqual([4]);
    expect(map.buttons.lookBack).toEqual([5, 7]);
    expect(map.buttons.attack).toEqual(DEFAULT_PAD_MAP.buttons.attack);
    expect(map.buttons.brake).toEqual(DEFAULT_PAD_MAP.buttons.brake);
    expect([map.steerAxis, map.steerAxisPair]).toEqual([2, 3]);
    expect(padMapFromBindings({})).toEqual(DEFAULT_PAD_MAP);
  });

  it('setOptions({ padBindings }) remaps a live pad; {} goes back to the defaults', () => {
    const p = pad();
    const { input, sample } = setup({ pads: [p] });
    input.setOptions({ padBindings: { kick: ['button4'], steer: ['axis2'] } });
    p.press(PAD.triangle);
    expect(has(sample(), 'kick')).toBe(false);
    p.release(PAD.triangle);
    p.press(PAD.l1);
    expect(has(sample(), 'kick')).toBe(true);
    p.release(PAD.l1);
    p.axes[0] = 1;
    expect(sample().steer).toBe(0); // the left stick no longer steers
    p.axes[2] = -1;
    expect(sample().steer).toBe(-127);
    input.setOptions({ padBindings: {} });
    p.axes[2] = 0;
    expect(sample().steer).toBe(127);
  });
});

describe('input-2: tilt', () => {
  const pitches = [20, 45, 70];
  const steers = [-30, -20, -10, -4, 0, 4, 10, 20, 30];

  it('gives the same steer sign in both landscape orientations, at 20, 45 and 70 degree hold pitches, monotonically', () => {
    for (const a of [90, 270]) {
      for (const pitch of pitches) {
        // Rounded to a micro-degree, so floating-point dust at a straight hold reads as zero.
        const angles = steers.map(
          (st) => Math.round(tiltAngleFromGravity(gravity(a, pitch, st), a)! * 1e6) / 1e6,
        );
        for (let i = 0; i < steers.length; i++) {
          expect(Math.sign(angles[i]!) + 0, `a=${a} pitch=${pitch} steer=${steers[i]}`).toBe(
            Math.sign(steers[i]!) + 0,
          );
          if (i > 0) expect(angles[i]!, `monotonic a=${a} pitch=${pitch}`).toBeGreaterThan(angles[i - 1]!);
        }
      }
    }
  });

  it('through createInput: the same turn steers the same way at angle 90 and 270, at every pitch', () => {
    for (const a of [90, 270]) {
      for (const pitch of pitches) {
        const t = setup({ controls: { steering: 'tilt' }, screenAngle: a });
        t.motion(gravity(a, pitch, 0));
        t.sample();
        t.input.calibrateTilt();
        // Past the 2-degree dead zone at every pitch: at 70 degrees a 10-degree turn dips the long
        // axis about 3.4 degrees.
        const turns = steers.filter((st) => st === 0 || Math.abs(st) >= 10);
        const out = turns.map((st) => {
          t.motion(gravity(a, pitch, st));
          for (let i = 0; i < 60; i++) t.sample(); // let the 0.1 s smoothing settle
          return t.sample().steer;
        });
        for (let i = 0; i < turns.length; i++) {
          expect(Math.sign(out[i]!) + 0, `a=${a} pitch=${pitch} steer=${turns[i]}`).toBe(
            Math.sign(turns[i]!) + 0,
          );
          if (i > 0) expect(out[i]!, `a=${a} pitch=${pitch}`).toBeGreaterThanOrEqual(out[i - 1]!);
        }
        expect(out[out.length - 1], `a=${a} pitch=${pitch} turns right`).toBeGreaterThan(0);
      }
    }
  });

  it('calibration zeroes the rest angle; dead zone 2 degrees and full lock 25 degrees', () => {
    const t = new TiltState(inputDefaults());
    t.reading(12); // the phone rests 12 degrees off
    t.steer();
    t.calibrate();
    t.reading(12 + 1.5);
    for (let i = 0; i < 60; i++) t.steer();
    expect(t.steer()).toBe(0);
    t.reading(12 + 25);
    for (let i = 0; i < 60; i++) t.steer();
    expect(t.steer()).toBeCloseTo(1, 3);
    t.reading(12 - 13.5); // half way from the dead zone to full lock, to the left
    for (let i = 0; i < 120; i++) t.steer();
    expect(t.steer()).toBeCloseTo(-0.5, 3);
  });

  it('sensitivity 2 needs half the tilt; the smoothing is a 0.1 s low-pass', () => {
    const t = new TiltState(inputDefaults());
    t.reading(0);
    t.steer();
    t.calibrate();
    t.sensitivity = 2;
    t.reading(12.5 + 1); // (13.5 - 2) / (12.5 - 2) > 1: full lock at half the angle
    const first = t.steer(DT)!;
    // One 1/60 s step of a 0.1 s low-pass moves 1 - e^(-1/6), about 15 %, of the way.
    expect(first).toBeLessThan(0.1);
    for (let i = 0; i < 60; i++) t.steer(DT);
    expect(t.steer(DT)).toBe(1);
    const sharp = new TiltState({ ...inputDefaults(), tiltSmoothingS: 0 });
    sharp.reading(0);
    sharp.steer();
    sharp.reading(25);
    expect(sharp.steer()).toBe(1);
  });

  it('falls back to deviceorientation beta when devicemotion never arrives, and devicemotion wins once seen', () => {
    expect(tiltAngleFromEuler(10, 0, 90)).toBeCloseTo(10, 6);
    expect(tiltAngleFromEuler(10, 0, 270)).toBeCloseTo(-10, 6);
    const t = setup({ controls: { steering: 'tilt' }, screenAngle: 90 });
    t.orientation(0, 0);
    t.sample();
    t.input.calibrateTilt();
    t.orientation(20, 0);
    for (let i = 0; i < 60; i++) t.sample();
    expect(t.sample().steer).toBeGreaterThan(0);
    t.motion(gravity(90, 45, -20));
    t.orientation(40, 0); // ignored now that devicemotion has spoken
    for (let i = 0; i < 60; i++) t.sample();
    expect(t.sample().steer).toBeLessThan(0);
  });

  it("steering methods: 'thumb' ignores the sensors, 'tilt' ignores the stick's steering, 'both' adds them", () => {
    const run = (steering: ControlOptions['steering']) => {
      const t = setup({ controls: { steering }, screenAngle: 90 });
      t.motion(gravity(90, 45, 0));
      t.sample();
      t.input.calibrateTilt();
      t.motion(gravity(90, 45, 8));
      for (let i = 0; i < 60; i++) t.sample();
      t.fire('pointerdown', 7, 150, 250, 1000);
      t.fire('pointermove', 7, 150 + 18, 250, 1010); // a light right thumb
      return t.sample().steer;
    };
    const thumb = run('thumb');
    const tilt = run('tilt');
    const both = run('both');
    expect(DEFAULT_CONTROL_OPTIONS.steering).toBe('thumb');
    expect(thumb).toBeGreaterThan(0);
    expect(tilt).toBeGreaterThan(0);
    // Each part is quantized on its own here, so the sum may differ by one step.
    expect(Math.abs(both - Math.min(127, thumb + tilt))).toBeLessThanOrEqual(1);
  });

  it('switching tilt off stops listening', () => {
    const t = setup({ controls: { steering: 'tilt' } });
    t.motion(gravity(90, 45, 0));
    t.sample();
    t.input.calibrateTilt();
    t.input.setOptions({ steering: 'thumb' });
    t.motion(gravity(90, 45, 30));
    for (let i = 0; i < 30; i++) t.sample();
    expect(t.sample().steer).toBe(0);
  });
});

describe('input-2: auto-throttle and pull-back brake', () => {
  it('auto-throttle produces full throttle with no touch on the stick; braking still wins', () => {
    const off = setup();
    expect(off.sample().throttle).toBe(0);
    const on = setup({ controls: { autoThrottle: true } });
    expect(on.sample().throttle).toBe(255);
    const [bx, by] = center('touch-brake');
    on.fire('pointerdown', 3, bx, by, 1000);
    const braking = on.sample();
    expect(braking.brake).toBe(255);
    expect(braking.throttle).toBe(0);
    on.fire('pointerup', 3, bx, by, 1100);
    on.sample(); // the latched brake drains
    expect(on.sample().throttle).toBe(255);
  });

  it('pull-back brake: pulling the stick down brakes only when the option is on', () => {
    const pull = (controls: Partial<ControlOptions>) => {
      const t = setup({ controls });
      t.fire('pointerdown', 7, 150, 200, 1000);
      t.fire('pointermove', 7, 150, 260, 1010); // a full stick range down
      return t.sample();
    };
    expect(DEFAULT_CONTROL_OPTIONS.pullBackBrake).toBe(false);
    expect(pull({}).brake).toBe(0);
    const on = pull({ pullBackBrake: true });
    expect(on.brake).toBe(255);
    expect(on.throttle).toBe(0);
  });
});

describe('input-2: haptics', () => {
  const ev = (
    type: SimEvent['type'],
    actor: number,
    target?: number,
    data: SimEvent['data'] = {},
  ): SimEvent => ({
    tick: 1,
    type,
    actor,
    ...(target === undefined ? {} : { target }),
    data,
  });

  it('a mocked navigator.vibrate fires only with haptics on', () => {
    const on = setup();
    on.input.onEvents([ev('hit', 0, 3)], 0);
    expect(on.vibrate).toHaveBeenCalledTimes(1);
    const off = setup({ controls: { haptics: false } });
    off.input.onEvents([ev('hit', 0, 3)], 0);
    off.input.onEvents([ev('crash', 0)], 0);
    expect(off.vibrate).not.toHaveBeenCalled();
    off.input.setOptions({ haptics: true });
    off.input.onEvents([ev('crash', 0)], 0);
    expect(off.vibrate).toHaveBeenCalledTimes(1);
  });

  it('uses the navigator.vibrate the browser offers by default', () => {
    const nav = globalThis.navigator as unknown as { vibrate?: unknown };
    const had = Object.getOwnPropertyDescriptor(nav, 'vibrate');
    const vibrate = vi.fn(() => true);
    Object.defineProperty(nav, 'vibrate', { value: vibrate, configurable: true });
    try {
      const h = createHaptics({ now: () => 0 });
      expect(h.supported).toBe(true);
      h.onEvents([ev('takedown', 2, 5)], 2);
      expect(vibrate).toHaveBeenCalledWith([40, 50, 90]);
      h.setEnabled(false);
      vibrate.mockClear();
      h.onEvents([ev('takedown', 2, 5)], 2, 1000);
      expect(vibrate).not.toHaveBeenCalled();
    } finally {
      if (had) Object.defineProperty(nav, 'vibrate', had);
      else delete nav.vibrate;
    }
  });

  it('is silently absent where the browser cannot vibrate', () => {
    const h = createHaptics({ vibrate: null });
    expect(h.supported).toBe(false);
    expect(() => h.onEvents([ev('crash', 0)], 0)).not.toThrow();
    expect(h.onEvents([ev('crash', 0)], 0)).toBeNull();
    const throwing = createHaptics({
      vibrate: () => {
        throw new Error('no user activation');
      },
    });
    expect(throwing.onEvents([ev('crash', 0)], 0)).toBeNull();
  });

  it("buzzes only for the player's own hits landed and taken, takedowns and crashes", () => {
    expect(hapticKind(ev('hit', 0, 4), 0)).toBe('hitLanded');
    expect(hapticKind(ev('hit', 4, 0), 0)).toBe('hitTaken');
    expect(hapticKind(ev('hit', 4, 5), 0)).toBeNull();
    expect(hapticKind(ev('takedown', 0, 4), 0)).toBe('takedown');
    expect(hapticKind(ev('takedown', 4, 0), 0)).toBeNull();
    expect(hapticKind(ev('crash', 0), 0)).toBe('crash');
    expect(hapticKind(ev('crash', 4), 0)).toBeNull();
    expect(hapticKind(ev('nearMiss', 0), 0)).toBeNull();
  });

  it('one buzz per step, the strongest wins, and a weaker one never cuts into a stronger one', () => {
    const vibrate = vi.fn((_p: number | number[]) => true);
    const h = createHaptics({ vibrate });
    expect(h.onEvents([ev('hit', 0, 4), ev('crash', 0)], 0, 0)).toBe('crash');
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(h.onEvents([ev('hit', 0, 4)], 0, 100)).toBeNull(); // the crash buzz is still playing
    expect(h.onEvents([ev('hit', 0, 4)], 0, 1000)).toBe('hitLanded');
    expect(vibrate).toHaveBeenCalledTimes(2);
  });

  it("a hit's buzz grows with its hitImpulse when combat reports one", () => {
    const vibrate = vi.fn((_p: number | number[]) => true);
    const h = createHaptics({ vibrate });
    h.onEvents([ev('hit', 0, 4, { hitImpulse: 0 })], 0, 0);
    h.onEvents([ev('hit', 0, 4, { hitImpulse: 1 })], 0, 1000);
    const [soft, hard] = vibrate.mock.calls.map((c) => (c[0] as number[])[0]!);
    expect(hard).toBeGreaterThan(soft!);
  });
});

describe('input-2: tuning declarations', () => {
  it('declares the M2 starting numbers as presentation-side tuning', () => {
    const byId = Object.fromEntries(INPUT_TUNING.map((d) => [d.id, d]));
    expect(byId['input.gamepadDeadZone']?.default).toBe(0.12);
    expect(byId['input.tiltDeadZoneDeg']?.default).toBe(2);
    expect(byId['input.tiltFullLockDeg']?.default).toBe(25);
    expect(byId['input.tiltSmoothingS']?.default).toBe(0.1);
    for (const d of INPUT_TUNING) expect(d.affectsSim, d.id).toBe(false);
  });
});
