// Playtest 4 (P4-7, [decided] "Wheelie button"): a small button by the right thumb, HOLD to lift the
// front and keep it up, RELEASE to drop it; the throttle stays the throttle. The touch double-tap of
// the stick is gone (it also popped wheelies by accident on quick flicks, per the moves audit), and
// the keyboard and the gamepad hold a key or a button with the same model. Every case is pure:
// pointer events carry timestamps, the keyboard and the gamepad step by dt, and no test waits on a
// wall clock or a frame count.
import { describe, expect, it } from 'vitest';
import classicPreset from '../../packs/base/hud/classic.json';
import {
  InputFlag,
  placeTouchButtons,
  type LayoutElement,
  type SimEvent,
  type SimInput,
  type TouchLayout,
} from '../sim/api';
import type { Rect } from '../core';
import { createHaptics } from './feedback';
import {
  createInput,
  DEFAULT_KEY_MAP,
  DEFAULT_PAD_MAP,
  emptyActions,
  GamepadState,
  hapticKind,
  hapticPattern,
  INPUT_TUNING,
  KEY_ACTION_NAMES,
  keyLegend,
  KeyboardState,
  PAD,
  type ControlOptions,
  type PadLike,
} from './index';

const W = 915;
const H = 412;
const DT = 1 / 60;

const classic = classicPreset as unknown as { elements: LayoutElement[] };
const layoutOf = (mirror = false, elements = classic.elements): TouchLayout => ({
  id: 'classic',
  mirror,
  elements,
});

class FakeSurface extends EventTarget {
  readonly style = { touchAction: '', pointerEvents: 'none' };
  constructor(
    private readonly w = W,
    private readonly h = H,
  ) {
    super();
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: this.w, height: this.h };
  }
  setPointerCapture() {}
}

function setup(
  opts: {
    controls?: Partial<ControlOptions>;
    layout?: TouchLayout;
    w?: number;
    h?: number;
    vibrate?: (p: number | number[]) => boolean;
  } = {},
) {
  const w = opts.w ?? W;
  const h = opts.h ?? H;
  const surface = new FakeSurface(w, h);
  const keys = new EventTarget();
  const input = createInput({
    keys,
    surface,
    layout: opts.layout ?? layoutOf(),
    ...(opts.controls ? { controls: opts.controls } : {}),
    ...(opts.vibrate ? { vibrate: opts.vibrate } : { vibrate: null }),
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
  return { input, fire, keys, sample: (): SimInput => input.sample(DT) };
}

const wheelie = (s: SimInput) => (s.flags & InputFlag.wheelie) !== 0;
const centre = (r: Rect | null): { x: number; y: number } => {
  if (!r) throw new Error('no button');
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
};
const buttons = (mirror = false, w = W, h = H) => placeTouchButtons(layoutOf(mirror), w, h);

describe('the wheelie button, touch', () => {
  it('holds the flag while the finger is down, from the first sample, and clears it on the lift', () => {
    const t = setup();
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 7, p.x, p.y, 0);
    const held = Array.from({ length: 30 }, () => t.sample());
    expect(held.every(wheelie)).toBe(true);
    t.fire('pointerup', 7, p.x, p.y, 500);
    expect(wheelie(t.sample())).toBe(false);
  });

  it('the throttle stays the throttle: full stick and the button at once, each its own', () => {
    const t = setup();
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, 150, 300, 0);
    t.fire('pointermove', 1, 150, 200, 16); // the stick pushed all the way up: full throttle
    t.fire('pointerdown', 2, p.x, p.y, 20);
    const s = t.sample();
    expect(wheelie(s)).toBe(true);
    expect(s.throttle).toBe(255);
    t.fire('pointerup', 2, p.x, p.y, 40);
    const after = t.sample();
    expect(wheelie(after)).toBe(false);
    expect(after.throttle).toBe(255);
  });

  it('a tap shorter than a tick is not lost: one sample carries it', () => {
    const t = setup();
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 3, p.x, p.y, 0);
    t.fire('pointerup', 3, p.x, p.y, 5);
    expect(wheelie(t.sample())).toBe(true);
    expect(wheelie(t.sample())).toBe(false);
  });

  it('a press is the button where ui draws it (the settled box), in both hands; next to it is not', () => {
    for (const mirror of [false, true]) {
      const t = setup({ layout: layoutOf(mirror) });
      const b = buttons(mirror);
      const r = b.wheelie;
      if (!r || !b.attack) throw new Error('missing');
      const p = centre(r);
      t.fire('pointerdown', 1, p.x, p.y, 0);
      expect(wheelie(t.sample()), `mirror ${mirror}`).toBe(true);
      t.fire('pointerup', 1, p.x, p.y, 20);
      t.sample();
      // On the attack button: an attack, never a wheelie.
      const a = centre(b.attack);
      t.fire('pointerdown', 2, a.x, a.y, 40);
      const s = t.sample();
      expect(wheelie(s), `mirror ${mirror}: on attack`).toBe(false);
      expect(s.flags & InputFlag.attack).toBe(InputFlag.attack);
      t.fire('pointerup', 2, a.x, a.y, 60);
      t.sample();
    }
  });

  it('upright, where the stick zone runs under the buttons, a press on the button is the button, not the stick', () => {
    const t = setup({ w: 412, h: 915 });
    const p = centre(placeTouchButtons(layoutOf(), 412, 915).wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    const s = t.sample();
    expect(wheelie(s)).toBe(true);
    expect(s.throttle).toBe(0);
    expect(t.input.stickBase()).toBeNull();
  });

  it('the double-tap of the stick is gone: no tap rhythm or flick on the stick ever raises it', () => {
    const t = setup();
    const seen: boolean[] = [];
    // The old gesture: tap, then press and hold 36 px up within 280 ms.
    t.fire('pointerdown', 1, 150, 300, 0);
    t.fire('pointerup', 1, 150, 300, 100);
    seen.push(wheelie(t.sample()));
    t.fire('pointerdown', 2, 150, 264, 200);
    for (let i = 0; i < 30; i++) seen.push(wheelie(t.sample()));
    t.fire('pointerup', 2, 150, 264, 800);
    // The audit's "pumping" case: 200 ms flicks up, 200 ms apart (it popped on the second flick).
    for (let k = 0; k < 6; k++) {
      const t0 = 1000 + k * 400;
      t.fire('pointerdown', 10 + k, 150, 300, t0);
      t.fire('pointermove', 10 + k, 150, 240, t0 + 50);
      for (let i = 0; i < 6; i++) seen.push(wheelie(t.sample()));
      t.fire('pointerup', 10 + k, 150, 240, t0 + 200);
      for (let i = 0; i < 6; i++) seen.push(wheelie(t.sample()));
    }
    expect(seen.length).toBeGreaterThan(60);
    expect(seen.some(Boolean)).toBe(false);
  });

  it('losing the window (blur) lets the button go', () => {
    const t = setup();
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    expect(wheelie(t.sample())).toBe(true);
    t.keys.dispatchEvent(new Event('blur'));
    t.sample();
    expect(wheelie(t.sample())).toBe(false);
  });

  it('a layout without the button has no wheelie zone: the spot is the stick or nothing', () => {
    const elements = classic.elements.filter((e) => e.element !== 'touch-wheelie');
    const t = setup({ layout: layoutOf(false, elements) });
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    expect(wheelie(t.sample())).toBe(false);
  });

  it('works under auto-throttle: the gas is full, and the button still lifts the front', () => {
    const t = setup({ controls: { autoThrottle: true } });
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    const s = t.sample();
    expect(wheelie(s)).toBe(true);
    expect(s.throttle).toBe(255);
  });

  it('the bot driver is untouched: its wheelie reaches the sim, and no device press leaks in', () => {
    const t = setup();
    t.input.setDriver((a) => {
      a.throttle = 0.6;
      a.wheelie = true;
    });
    expect(wheelie(t.sample())).toBe(true);
    t.input.setDriver(() => {});
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    expect(wheelie(t.sample())).toBe(false);
  });
});

describe('the stick base (the wheelie gauge stands beside it)', () => {
  it('is null with no thumb down, the stick base while one is down, and null after the lift', () => {
    const t = setup();
    expect(t.input.stickBase()).toBeNull();
    t.fire('pointerdown', 1, 150, 300, 0);
    expect(t.input.stickBase()).toEqual({ x: 150, y: 300 });
    t.fire('pointermove', 1, 170, 250, 30);
    expect(t.input.stickBase()).toEqual({ x: 150, y: 300 }); // the base does not follow the thumb
    t.fire('pointerup', 1, 170, 250, 60);
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

describe('the wheelie key: hold H', () => {
  it('holds the flag while H is down, from the first sample, and clears it on release', () => {
    for (const code of DEFAULT_KEY_MAP.wheelie) {
      const kb = new KeyboardState();
      kb.down(code);
      expect(
        stepKeys(kb, 20).every((a) => a.wheelie === true),
        code,
      ).toBe(true);
      kb.up(code);
      expect(stepKeys(kb, 1)[0]?.wheelie ?? false, code).toBe(false);
    }
    expect(DEFAULT_KEY_MAP.wheelie).toEqual(['KeyH']);
  });

  it('a press and release between two samples still lifts for one sample (latched)', () => {
    const kb = new KeyboardState();
    kb.down('KeyH');
    kb.up('KeyH');
    const [first, second] = stepKeys(kb, 2);
    expect(first?.wheelie).toBe(true);
    expect(second?.wheelie ?? false).toBe(false);
  });

  it('W is only the throttle: a tap then a hold of W never lifts the front', () => {
    const kb = new KeyboardState();
    kb.down('KeyW');
    stepKeys(kb, 6);
    kb.up('KeyW');
    stepKeys(kb, 3);
    kb.down('KeyW');
    const held = stepKeys(kb, 60);
    expect(held.some((a) => a.wheelie === true)).toBe(false);
    expect(held.at(-1)?.throttle).toBe(1);
  });

  it('W and H together: full gas and the wheelie, each its own', () => {
    const kb = new KeyboardState();
    kb.down('KeyW');
    kb.down('KeyH');
    const last = stepKeys(kb, 30).at(-1);
    expect(last?.wheelie).toBe(true);
    expect(last?.throttle).toBe(1);
  });

  it('the legend says hold, on a wheelie row of its own; the throttle row is just the ride', () => {
    expect(KEY_ACTION_NAMES.wheelie).toBe('wheelie (hold)');
    expect(KEY_ACTION_NAMES.throttle).toBe('ride');
    const rows = keyLegend();
    expect(rows.find((r) => r.action === 'wheelie (hold)')?.keys).toBe('H');
  });
});

function pad(pressed: readonly number[], r2 = 0): PadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const on = pressed.includes(i);
    return { pressed: on, value: on ? 1 : 0 };
  });
  buttons[PAD.r2] = { pressed: r2 >= 0.5, value: r2 };
  return { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
}

describe('the wheelie button, gamepad: hold R3', () => {
  it('holds the flag while R3 is held and clears it on release; R2 stays the throttle', () => {
    expect(DEFAULT_PAD_MAP.buttons.wheelie).toEqual([PAD.r3]);
    const gp = new GamepadState();
    const sample = (p: PadLike) => {
      const a = emptyActions();
      gp.sample(a, [p], 0.2, DT);
      return a;
    };
    const held = Array.from({ length: 20 }, () => sample(pad([PAD.r3], 1)));
    expect(held.every((a) => a.wheelie === true && a.throttle === 1)).toBe(true);
    const off = sample(pad([], 1));
    expect(off.wheelie ?? false).toBe(false);
    expect(off.throttle).toBe(1);
  });

  it('two pulls of R2 never lift the front', () => {
    const gp = new GamepadState();
    const seen: boolean[] = [];
    const step = (r2: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const a = emptyActions();
        gp.sample(a, [pad([], r2)], 0.2, DT);
        seen.push(a.wheelie === true);
      }
    };
    step(1, 6);
    step(0, 3);
    step(0.8, 60);
    expect(seen.some(Boolean)).toBe(false);
  });
});

describe('the wheelie: tuning and feedback', () => {
  it('the double-tap sliders are gone from the input tuning', () => {
    expect(INPUT_TUNING.some((d) => d.id.startsWith('input.wheelieTap'))).toBe(false);
  });

  it('a loop-out buzzes the crash pattern, through the crash event and through wheelieEnd', () => {
    const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}): SimEvent =>
      ({ type, actor, data, tick: 1, id: 1 }) as unknown as SimEvent;
    expect(hapticKind(ev('crash', 0, { cause: 'wheelie', loopOut: true }), 0)).toBe('crash');
    expect(hapticKind(ev('wheelieEnd', 0, { loopOut: true }), 0)).toBe('crash');
    expect(hapticKind(ev('wheelieEnd', 0, { loopOut: false, clean: true }), 0)).toBeNull();
    expect(hapticKind(ev('wheelieEnd', 4, { loopOut: true }), 0)).toBeNull();
  });

  it('the band turning high buzzes 30 ms, once per turn', () => {
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
    expect(h.onMoves({ wheelieBand: 'sweet' }, 1100)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'high' }, 1200)).toBe('wheelieHigh');
    expect(h.onMoves({ wheelieBand: 'high' }, 1300)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'sweet' }, 1400)).toBeNull();
    expect(h.onMoves({ wheelieBand: 'high' }, 1500)).toBe('wheelieHigh');
    expect(buzzes).toEqual([[30], [30]]);
  });

  it('pressing the button on a phone ticks 12 ms once, on the first sample of the press', () => {
    const buzzes: (number | number[])[] = [];
    const t = setup({
      vibrate: (p) => {
        buzzes.push(p);
        return true;
      },
    });
    const p = centre(buttons().wheelie);
    t.fire('pointerdown', 1, p.x, p.y, 0);
    for (let i = 0; i < 5; i++) t.sample();
    expect(buzzes).toEqual([[12]]);
    t.fire('pointerup', 1, p.x, p.y, 100);
    t.sample();
    t.fire('pointerdown', 2, p.x, p.y, 200);
    t.sample();
    expect(buzzes).toEqual([[12], [12]]);
  });
});
