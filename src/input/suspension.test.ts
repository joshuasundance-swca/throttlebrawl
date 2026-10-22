import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputFlag, placeTouchButtons, type TouchLayout } from '../sim/api';
import { createInput, emptyActions, inputDefaults, PAD, toSimInput, type InputSystem } from './index';

const DT = 1 / 60;
const NEUTRAL = toSimInput(emptyActions());
const LAYOUT: TouchLayout = {
  id: 'suspension',
  mirror: false,
  elements: [
    {
      element: 'touch-attack',
      visible: true,
      anchor: 'bottom-right',
      offset: [0.1, 0.1],
      scale: 1,
      opacity: 1,
    },
    {
      element: 'touch-stick-zone',
      visible: true,
      anchor: 'bottom-left',
      offset: [0, 0],
      size: [0.5, 1],
      scale: 1,
      opacity: 1,
    },
  ],
};

class Surface extends EventTarget {
  captures = vi.fn();
  setPointerCapture = this.captures;
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 915, height: 412 };
  }
}

const systems: InputSystem[] = [];
afterEach(() => {
  for (const input of systems.splice(0)) input.dispose();
  vi.restoreAllMocks();
});

function setup() {
  const keys = new EventTarget();
  const surface = new Surface();
  const vibrate = vi.fn(() => true);
  const pad = {
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  };
  const pads: (typeof pad | null)[] = [pad];
  const input = createInput({ keys, surface, layout: LAYOUT, gamepads: () => pads, vibrate });
  systems.push(input);
  const key = (type: 'keydown' | 'keyup', code: string, repeat = false) => {
    keys.dispatchEvent(Object.assign(new Event(type), { code, repeat }));
  };
  const pointer = (type: string, id: number, x: number, y: number) => {
    surface.dispatchEvent(Object.assign(new Event(type), { pointerId: id, clientX: x, clientY: y }));
  };
  const attack = (type: string, id: number, layout = LAYOUT) => {
    const r = placeTouchButtons(layout, 915, 412).attack!;
    pointer(type, id, r.x + r.w / 2, r.y + r.h / 2);
  };
  const button = (index: number, value: number) => {
    pad.buttons[index] = { pressed: value >= 0.5, value };
  };
  return {
    input,
    keys,
    surface,
    vibrate,
    pad,
    pads,
    key,
    pointer,
    attack,
    button,
    sample: () => input.sample(DT),
  };
}

describe('input suspension ownership', () => {
  it('clears pending keyboard and touch attacks at transfer without needing a sample', () => {
    const t = setup();
    t.key('keydown', 'KeyJ');
    t.attack('pointerdown', 1);
    t.pointer('pointerdown', 2, 150, 200);
    t.pointer('pointermove', 2, 190, 150);
    expect(t.input.stickBase()).not.toBeNull();
    const lease = t.input.acquireSuspendLease();
    expect(t.input.lastActions()).toEqual(emptyActions());
    expect(t.input.stickBase()).toBeNull();
    t.attack('pointerdown', 3);
    lease.release();
    t.key('keydown', 'KeyJ', true);
    t.pointer('pointermove', 2, 220, 100);
    expect(t.sample()).toEqual(NEUTRAL);
    t.key('keyup', 'KeyJ');
    t.key('keydown', 'KeyJ');
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
    t.key('keyup', 'KeyJ');
    t.attack('pointerup', 3);
    t.attack('pointerdown', 4);
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
  });

  it('quarantines keys pressed during ownership and unknown autorepeat after a blur', () => {
    const t = setup();
    const lease = t.input.acquireSuspendLease();
    t.key('keydown', 'KeyW');
    t.key('keydown', 'KeyC');
    t.keys.dispatchEvent(new Event('blur'));
    lease.release();
    t.key('keydown', 'KeyW', true);
    t.key('keydown', 'KeyC', true);
    expect(t.sample()).toEqual(NEUTRAL);
    expect(t.input.lastActions().cycleCamera).toBeUndefined();
    t.key('keyup', 'KeyW');
    t.key('keyup', 'KeyC');
    t.key('keydown', 'KeyW');
    t.key('keydown', 'KeyC');
    expect(t.sample().throttle).toBeGreaterThan(0);
    expect(t.input.lastActions().cycleCamera).toBe(true);
  });

  it('requires gamepad buttons and axes held across either boundary to return to neutral', () => {
    const t = setup();
    t.button(PAD.cross, 1);
    t.pad.axes[0] = 1;
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
    const lease = t.input.acquireSuspendLease();
    t.button(PAD.r3, 1);
    t.button(PAD.options, 1);
    t.button(PAD.dpadUp, 1);
    t.button(PAD.r2, 0.3);
    expect(t.sample()).toEqual(NEUTRAL);
    lease.release();
    expect(t.sample()).toEqual(NEUTRAL);
    expect(t.input.lastActions()).toEqual(emptyActions());
    for (const index of [PAD.cross, PAD.r3, PAD.options, PAD.dpadUp, PAD.r2]) t.button(index, 0);
    t.pad.axes[0] = 0;
    expect(t.sample()).toEqual(NEUTRAL);
    t.button(PAD.cross, 1);
    t.button(PAD.r3, 1);
    t.button(PAD.options, 1);
    t.button(PAD.dpadUp, 1);
    t.button(PAD.r2, 0.3);
    t.pad.axes[0] = 1;
    const fresh = t.sample();
    expect(fresh.flags & InputFlag.attack).toBeTruthy();
    expect(fresh.flags & InputFlag.wheelie).toBeTruthy();
    expect(fresh.throttle).toBeGreaterThan(0);
    expect(fresh.steer).toBe(127);
    expect(t.input.lastActions().cycleCamera).toBe(true);
    expect(t.input.lastActions().pause).toBe(true);
    t.sample();
    expect(t.input.lastActions().attack).toBe(false);
  });

  it('does no driver, tilt, pointer capture or haptic work while owned and preserves configuration', () => {
    const t = setup();
    const driver = vi.fn((a: ReturnType<typeof emptyActions>) => {
      a.throttle = 0.7;
    });
    const tilt = { steer: vi.fn(() => 0.5), calibrate: vi.fn(), dispose: vi.fn() };
    t.input.setOptions({ autoThrottle: true, pullBackBrake: true, keyBindings: { attack: ['KeyX'] } });
    const options = t.input.options();
    t.input.setTilt(tilt);
    t.input.setDriver(driver);
    t.sample();
    driver.mockClear();
    const lease = t.input.acquireSuspendLease();
    t.attack('pointerdown', 5);
    t.key('keydown', 'KeyH');
    t.button(PAD.r3, 1);
    expect(t.sample()).toEqual(NEUTRAL);
    t.input.onMoves({ wheelieBand: 'high' });
    t.input.onEvents([{ tick: 1, type: 'crash', actor: 0, data: {} }], 0);
    t.input.haptics.pulse('crash');
    expect(driver).not.toHaveBeenCalled();
    expect(tilt.steer).not.toHaveBeenCalled();
    expect(tilt.dispose).not.toHaveBeenCalled();
    expect(t.surface.captures).not.toHaveBeenCalled();
    expect(t.vibrate).not.toHaveBeenCalled();
    expect(t.input.lastActions()).toEqual(emptyActions());
    lease.release();
    expect(t.input.options()).toEqual(options);
    expect(t.sample().throttle).toBe(Math.round(0.7 * 255));
    expect(driver).toHaveBeenCalledTimes(1);
    t.input.setDriver(null);
    expect(t.sample().throttle).toBe(255);
    expect(tilt.steer).toHaveBeenCalledTimes(1);
    t.key('keydown', 'KeyX');
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
  });

  it.each([0, 2])(
    'quarantines the active radial stick pair (axis %i), including sub-threshold diagonals',
    (axis) => {
      const t = setup();
      t.input.setOptions({ padBindings: { steer: [`axis${axis}`] } });
      const dz = inputDefaults().gamepadDeadZone;
      const diagonal = dz * 0.9;
      expect(diagonal).toBeLessThan(dz);
      expect(Math.hypot(diagonal, diagonal)).toBeGreaterThan(dz);
      t.pad.axes[axis] = diagonal;
      t.pad.axes[axis + 1] = diagonal;
      expect(t.sample().steer).toBeGreaterThan(0);
      const lease = t.input.acquireSuspendLease();
      lease.release();
      expect(t.sample()).toEqual(NEUTRAL);
      t.pad.axes[axis] = 1;
      t.pad.axes[axis + 1] = 0;
      expect(t.sample()).toEqual(NEUTRAL);
      t.pad.axes[axis] = diagonal;
      t.pad.axes[axis + 1] = diagonal;
      expect(t.sample()).toEqual(NEUTRAL);
      t.pad.axes[axis] = dz / 2;
      t.pad.axes[axis + 1] = dz / 2;
      expect(t.sample()).toEqual(NEUTRAL);
      t.pad.axes[axis] = 1;
      expect(t.sample().steer).toBeGreaterThan(0);
    },
  );

  it.each(['throttle', 'brake'] as const)(
    'rearms digital actions below their held threshold while shared %s remains quarantined',
    (analog) => {
      const t = setup();
      t.input.setOptions({ padBindings: { attack: ['button7'], [analog]: ['button7'] } });
      t.button(PAD.r2, 1);
      expect(t.sample().flags & InputFlag.attack).toBeTruthy();
      const lease = t.input.acquireSuspendLease();
      lease.release();
      expect(t.sample()).toEqual(NEUTRAL);
      t.button(PAD.r2, 0.25); // released as a digital action, still active as an analog action
      expect(t.sample()).toEqual(NEUTRAL);
      t.button(PAD.r2, 1);
      const repressed = t.sample();
      expect(repressed.flags & InputFlag.attack).toBeTruthy();
      expect(repressed[analog]).toBe(0);
      t.button(PAD.r2, 0);
      expect(t.sample()).toEqual(NEUTRAL);
      t.button(PAD.r2, 0.25);
      expect(t.sample()[analog]).toBe(Math.round(0.25 * 255));
    },
  );

  it('preserves sparse pad indices and allows an alternate binding while one button stays held', () => {
    const t = setup();
    t.pads.unshift(null);
    t.input.setOptions({ padBindings: { attack: ['button0', 'button8'] } });
    t.button(PAD.cross, 1);
    const lease = t.input.acquireSuspendLease();
    lease.release();
    expect(t.sample()).toEqual(NEUTRAL);
    t.button(PAD.share, 1);
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
    t.button(PAD.share, 0);
    expect(t.sample().flags & InputFlag.attack).toBe(0);
    t.button(PAD.cross, 0.25);
    t.sample();
    t.button(PAD.cross, 1);
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
  });

  it('keeps nested leases independent and stale releases cannot clear fresh input', () => {
    const t = setup();
    const first = t.input.acquireSuspendLease();
    const second = t.input.acquireSuspendLease();
    first.release();
    first.release();
    t.key('keydown', 'KeyJ');
    expect(t.sample()).toEqual(NEUTRAL);
    second.release();
    t.key('keyup', 'KeyJ');
    t.key('keydown', 'KeyJ');
    first.release();
    second.release();
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
    const third = t.input.acquireSuspendLease();
    second.release();
    expect(t.sample()).toEqual(NEUTRAL);
    third.release();
  });

  it('allows fresh controls immediately while unrelated held controls stay quarantined', () => {
    const t = setup();
    t.button(PAD.cross, 1);
    const lease = t.input.acquireSuspendLease();
    t.key('keydown', 'KeyJ');
    t.button(PAD.r2, 1);
    t.button(PAD.r2, 0); // released during the viewer, with no normal input sampling
    lease.release();
    t.key('keydown', 'KeyA');
    t.button(PAD.r2, 1);
    const fresh = t.sample();
    expect(fresh.steer).toBe(-127);
    expect(fresh.throttle).toBe(255);
    expect(fresh.flags).toBe(0);
    t.button(PAD.cross, 0);
    t.sample();
    t.button(PAD.cross, 1);
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
  });

  it('stops active feedback and retires the high-band latch without changing the saved toggle', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const t = setup();
    // An explicit timestamp avoids a wait for the previous pulse's priority window.
    t.input.haptics.onMoves({ wheelieBand: 'high' }, 0);
    expect(t.vibrate).toHaveBeenCalledWith([30]);
    const lease = t.input.acquireSuspendLease();
    expect(t.vibrate).toHaveBeenLastCalledWith(0);
    expect(t.input.options().haptics).toBe(true);
    t.vibrate.mockClear();
    t.input.haptics.onMoves({ wheelieBand: 'high' }, 1000);
    t.input.haptics.setEnabled(true);
    t.input.haptics.pulse('crash');
    expect(t.vibrate).not.toHaveBeenCalled();
    lease.release();
    t.input.haptics.onMoves({ wheelieBand: 'high' }, 2000);
    expect(t.vibrate).toHaveBeenCalledWith([30]);
  });

  it('preserves a mirrored layout and resets wheelie edges for fresh input after release', () => {
    const t = setup();
    const mirrored = { ...LAYOUT, mirror: true };
    t.input.setLayout(mirrored);
    t.key('keydown', 'KeyH');
    expect(t.sample().flags & InputFlag.wheelie).toBeTruthy();
    const lease = t.input.acquireSuspendLease();
    t.key('keyup', 'KeyH');
    lease.release();
    t.vibrate.mockClear();
    t.key('keydown', 'KeyH');
    expect(t.sample().flags & InputFlag.wheelie).toBeTruthy();
    expect(t.vibrate).toHaveBeenCalledWith([12]);
    t.attack('pointerdown', 6, mirrored);
    expect(t.sample().flags & InputFlag.attack).toBeTruthy();
  });

  it('disposal retires leases and input without resuming the retained driver', () => {
    const t = setup();
    const driver = vi.fn();
    t.input.setDriver(driver);
    const lease = t.input.acquireSuspendLease();
    t.input.dispose();
    lease.release();
    lease.release();
    t.input.acquireSuspendLease().release();
    t.key('keydown', 'KeyJ');
    expect(t.sample()).toEqual(NEUTRAL);
    expect(driver).not.toHaveBeenCalled();
    expect(t.input.lastActions()).toEqual(emptyActions());
  });
});
