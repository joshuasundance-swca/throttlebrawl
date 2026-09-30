// input-1 unit acceptance (docs/milestones/M1.md, "input-1"): the touch device path through
// createInput, driven by pointer events on a stand-in surface, so the listeners, latching and
// release handling under test are the real ones.
import { describe, expect, it } from 'vitest';
import { InputFlag, placeElement, type SimInput, type TouchLayout } from '../sim/api';
import { createInput, type InputSystem } from './index';

const W = 915;
const H = 412;
const DT = 1 / 60;

// The touch elements of the classic HUD layout (packs/base/hud/classic.json).
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
  readonly captured = new Set<number>();
  getBoundingClientRect() {
    return { left: 0, top: 0, width: W, height: H };
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
}

function center(element: string, layout: TouchLayout = LAYOUT): [number, number] {
  const el = layout.elements.find((e) => e.element === element);
  if (!el) throw new Error(element);
  const r = placeElement(el, W, H, layout.mirror);
  return [r.x + r.w / 2, r.y + r.h / 2];
}

function setup(layout: TouchLayout = LAYOUT) {
  const surface = new FakeSurface();
  const keys = new EventTarget();
  const input: InputSystem = createInput({ keys, surface, layout });
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
  return { surface, input, fire, sample: (): SimInput => input.sample(DT) };
}

const has = (s: SimInput, flag: keyof typeof InputFlag) => (s.flags & InputFlag[flag]) !== 0;

describe('input-1: the attack button', () => {
  it('a tap sets attack on the next sampled tick, exactly once', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    fire('pointerup', 1, x, y, 1010); // the whole tap falls between two ticks
    const first = sample();
    expect(has(first, 'attack')).toBe(true);
    expect(has(first, 'kick')).toBe(false);
    expect(has(first, 'attackSideLeft') || has(first, 'attackSideRight')).toBe(false);
    for (let i = 0; i < 5; i++) expect(has(sample(), 'attack')).toBe(false);
  });

  it('holding the button does not repeat the attack', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    const ticks = Array.from({ length: 20 }, sample);
    expect(ticks.filter((s) => has(s, 'attack'))).toHaveLength(1);
    expect(has(ticks[0]!, 'attack')).toBe(true);
  });

  it('a 30 px drag to the right sets attackSideRight, and to the left attackSideLeft', () => {
    const right = setup();
    const [x, y] = center('touch-attack');
    right.fire('pointerdown', 1, x, y, 1000);
    expect(has(right.sample(), 'attack')).toBe(true);
    right.fire('pointermove', 1, x + 15, y, 1020);
    right.fire('pointermove', 1, x + 30, y + 2, 1040);
    const after = right.sample();
    expect(has(after, 'attackSideRight')).toBe(true);
    expect(has(after, 'attackSideLeft')).toBe(false);
    expect(has(after, 'kick')).toBe(false);
    // Level-held while the finger stays down.
    expect(has(right.sample(), 'attackSideRight')).toBe(true);

    const left = setup();
    left.fire('pointerdown', 1, x, y, 1000);
    left.fire('pointermove', 1, x - 30, y, 1030);
    expect(has(left.sample(), 'attackSideLeft')).toBe(true);
  });

  it('a 30 px swipe down in 70 ms sets kick; a slow 30 px drag down over 300 ms does not', () => {
    const fast = setup();
    const [x, y] = center('touch-attack');
    fast.fire('pointerdown', 1, x, y, 1000);
    fast.fire('pointermove', 1, x, y + 12, 1035);
    fast.fire('pointermove', 1, x + 2, y + 30, 1070);
    fast.fire('pointerup', 1, x + 2, y + 30, 1075); // lifted before the tick samples it
    const kick = fast.sample();
    expect(has(kick, 'attack')).toBe(true);
    expect(has(kick, 'kick')).toBe(true);
    expect(has(fast.sample(), 'kick')).toBe(false); // released and sampled once: cleared

    const slow = setup();
    slow.fire('pointerdown', 1, x, y, 1000);
    const seen: SimInput[] = [slow.sample()];
    for (let i = 1; i <= 10; i++) {
      slow.fire('pointermove', 1, x, y + 3 * i, 1000 + 30 * i);
      seen.push(slow.sample(), slow.sample());
    }
    slow.fire('pointerup', 1, x, y + 30, 1310);
    seen.push(slow.sample());
    expect(seen.some((s) => has(s, 'kick'))).toBe(false);
    expect(seen.filter((s) => has(s, 'attack'))).toHaveLength(1);
  });

  it('a swipe down that takes 100 ms does not convert', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    fire('pointermove', 1, x, y + 10, 1033);
    fire('pointermove', 1, x, y + 20, 1066);
    fire('pointermove', 1, x, y + 30, 1100);
    fire('pointerup', 1, x, y + 30, 1105);
    const s = sample();
    expect(has(s, 'attack')).toBe(true);
    expect(has(s, 'kick')).toBe(false);
  });

  it('a diagonal steeper than 45 degrees down is a kick, not a side', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    fire('pointermove', 1, x + 25, y + 30, 1050);
    const s = sample();
    expect(has(s, 'kick')).toBe(true);
    expect(has(s, 'attackSideRight')).toBe(false);
  });

  it('a tap also asks to skip the run-back (the sim uses it only on foot)', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    fire('pointerup', 1, x, y, 1010);
    expect(has(sample(), 'skipRunBack')).toBe(true);
    expect(has(sample(), 'skipRunBack')).toBe(false);
  });
});

describe('input-1: the stick, the brake and releases', () => {
  it('drag up gives scaled throttle, sideways steers, lift coasts', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 7, 150, 250, 1000);
    fire('pointermove', 7, 150, 220, 1010); // half the 60 px range
    const half = sample();
    expect(half.throttle).toBeGreaterThan(110);
    expect(half.throttle).toBeLessThan(140);
    fire('pointermove', 7, 210, 150, 1020);
    const full = sample();
    expect(full.throttle).toBe(255);
    expect(full.steer).toBe(127);
    fire('pointerup', 7, 210, 150, 1030);
    const coast = sample();
    expect(coast.throttle).toBe(0);
    expect(coast.steer).toBe(0);
  });

  it('a pointercancel releases the throttle', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 3, 150, 250, 1000);
    fire('pointermove', 3, 150, 180, 1016);
    expect(sample().throttle).toBe(255);
    fire('pointercancel', 3, 150, 180, 1030);
    const after = sample();
    expect(after.throttle).toBe(0);
    expect(after.steer).toBe(0);
  });

  it('small thumb wobble inside the dead zone does not steer', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 3, 150, 250, 1000);
    fire('pointermove', 3, 153, 250, 1016);
    expect(sample().steer).toBe(0);
  });

  it('touches in the 24 px edge strip are ignored (the back gesture owns them)', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 3, 10, 250, 1000);
    fire('pointermove', 3, 10, 150, 1016);
    expect(sample().throttle).toBe(0);
  });

  it('the stick base sits at least one stick radius from the screen edge', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 3, 30, 250, 1000); // inside the zone, but closer than 60 px to the edge
    fire('pointermove', 3, 60, 250, 1016); // at the clamped base: no steer
    expect(sample().steer).toBe(0);
  });

  it('the brake button brakes while held, and a quick tap is latched for one tick', () => {
    const { fire, sample } = setup();
    const [x, y] = center('touch-brake');
    fire('pointerdown', 4, x, y, 1000);
    expect(sample().brake).toBe(255);
    expect(sample().brake).toBe(255);
    fire('pointerup', 4, x, y, 1040);
    expect(sample().brake).toBe(0);
    fire('pointerdown', 4, x, y, 1100);
    fire('pointerup', 4, x, y, 1105);
    expect(sample().brake).toBe(255);
    expect(sample().brake).toBe(0);
  });

  it('two thumbs work at once: throttle on the stick while attacking', () => {
    const { fire, sample } = setup();
    fire('pointerdown', 1, 150, 250, 1000);
    fire('pointermove', 1, 150, 180, 1005);
    const [x, y] = center('touch-attack');
    fire('pointerdown', 2, x, y, 1010);
    const s = sample();
    expect(s.throttle).toBe(255);
    expect(has(s, 'attack')).toBe(true);
  });

  it('captures each pointer, sets touch-action none and turns pointer events on for the surface', () => {
    const { surface, fire } = setup();
    fire('pointerdown', 9, 150, 250, 1000);
    expect(surface.captured.has(9)).toBe(true);
    expect(surface.style.touchAction).toBe('none');
    expect(surface.style.pointerEvents).toBe('auto');
  });
});

describe('input-1: the left-handed mirror', () => {
  it('the mirrored layout swaps the zones', () => {
    const mirrored: TouchLayout = { ...LAYOUT, mirror: true };
    const { fire, sample } = setup(mirrored);
    // The attack button is now on the left: a tap there attacks.
    const [ax, ay] = center('touch-attack', mirrored);
    expect(ax).toBeLessThan(W / 2);
    fire('pointerdown', 1, ax, ay, 1000);
    fire('pointerup', 1, ax, ay, 1005);
    expect(has(sample(), 'attack')).toBe(true);
    // The stick zone is now on the right: a drag up there gives throttle.
    fire('pointerdown', 2, W - 150, 250, 1100);
    fire('pointermove', 2, W - 150, 180, 1110);
    expect(sample().throttle).toBe(255);
    fire('pointerup', 2, W - 150, 180, 1120);
    // And the old stick spot on the left, away from the mirrored buttons, does nothing.
    fire('pointerdown', 3, 150, 60, 1200);
    fire('pointermove', 3, 150, 0, 1210);
    const s = sample();
    expect(s.throttle).toBe(0);
    expect(has(s, 'attack')).toBe(false);
  });

  it('setLayout switches to the mirror at run time', () => {
    const { input, fire, sample } = setup();
    input.setLayout({ ...LAYOUT, mirror: true });
    fire('pointerdown', 2, W - 150, 250, 1100);
    fire('pointermove', 2, W - 150, 180, 1110);
    expect(sample().throttle).toBe(255);
  });
});

describe('input-1: tuning and seams', () => {
  it('the thresholds are live tuning parameters', () => {
    const { input, fire, sample } = setup();
    input.setParam('input.attackDragPx', 40);
    const [x, y] = center('touch-attack');
    fire('pointerdown', 1, x, y, 1000);
    fire('pointermove', 1, x + 30, y, 1030);
    expect(has(sample(), 'attackSideRight')).toBe(false);
  });

  it('a tilt source adds to the steering (a seam in M1)', () => {
    const { input, sample } = setup();
    input.setTilt({ steer: () => -0.4 });
    expect(sample().steer).toBe(-51);
    input.setTilt(null);
    expect(sample().steer).toBe(0);
  });

  it('the bot driver replaces the devices', () => {
    const { input, fire, sample } = setup();
    fire('pointerdown', 7, 150, 250, 1000);
    fire('pointermove', 7, 150, 150, 1010);
    input.setDriver((a) => {
      a.brake = 1;
    });
    const s = sample();
    expect(s.brake).toBe(255);
    expect(s.throttle).toBe(0);
  });
});
