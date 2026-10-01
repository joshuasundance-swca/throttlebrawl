// The camera's view action (camera-3's farChase and helmet views; the integration round,
// 2026-10-01): C on the keyboard and d-pad up on a gamepad give a `cycleCamera` press edge, once
// per press. It is presentation only: it never reaches the SimInput, so a replay never sees it.
import { describe, expect, it } from 'vitest';
import type { TouchLayout } from '../sim/api';
import {
  createInput,
  DEFAULT_KEY_MAP,
  DEFAULT_PAD_MAP,
  keyLegend,
  PAD,
  toSimInput,
  emptyActions,
} from './index';

const LAYOUT: TouchLayout = { id: 't', mirror: false, elements: [] };
const DT = 1 / 60;

class Surface extends EventTarget {
  readonly style = { touchAction: '', pointerEvents: '' };
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 915, height: 412 };
  }
}

function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  const e = new Event(type);
  Object.defineProperties(e, { code: { value: code }, repeat: { value: repeat } });
  target.dispatchEvent(e);
}

function setup() {
  const keys = new EventTarget();
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  const padLike = { connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons };
  const input = createInput({
    keys,
    surface: new Surface(),
    layout: LAYOUT,
    gamepads: () => [padLike],
    vibrate: null,
  });
  return { input, keys, buttons };
}

describe('input: the camera view action', () => {
  it('C gives one press edge per press, held or not', () => {
    const { input, keys } = setup();
    key(keys, 'keydown', 'KeyC');
    input.sample(DT);
    expect(input.lastActions().cycleCamera).toBe(true);
    key(keys, 'keydown', 'KeyC', true); // auto-repeat while held
    input.sample(DT);
    expect(input.lastActions().cycleCamera ?? false).toBe(false);
    key(keys, 'keyup', 'KeyC');
    input.sample(DT);
    expect(input.lastActions().cycleCamera ?? false).toBe(false);
    // A tap between two samples still counts (latched).
    key(keys, 'keydown', 'KeyC');
    key(keys, 'keyup', 'KeyC');
    input.sample(DT);
    expect(input.lastActions().cycleCamera).toBe(true);
  });

  it('d-pad up on a gamepad gives one press edge per press', () => {
    const { input, buttons } = setup();
    expect(DEFAULT_PAD_MAP.buttons.cycleCamera).toEqual([PAD.dpadUp]);
    buttons[PAD.dpadUp] = { pressed: true, value: 1 };
    input.sample(DT);
    expect(input.lastActions().cycleCamera).toBe(true);
    input.sample(DT);
    expect(input.lastActions().cycleCamera ?? false).toBe(false);
    buttons[PAD.dpadUp] = { pressed: false, value: 0 };
    input.sample(DT);
    buttons[PAD.dpadUp] = { pressed: true, value: 1 };
    input.sample(DT);
    expect(input.lastActions().cycleCamera).toBe(true);
  });

  it('still counts while the bot drives (presentation, not a race input)', () => {
    const { input, keys } = setup();
    input.setDriver((a) => {
      a.throttle = 1;
    });
    key(keys, 'keydown', 'KeyC');
    input.sample(DT);
    expect(input.lastActions().cycleCamera).toBe(true);
    expect(input.lastActions().throttle).toBe(1);
  });

  it('never reaches the SimInput', () => {
    const a = emptyActions();
    a.cycleCamera = true;
    expect(toSimInput(a)).toEqual(toSimInput(emptyActions()));
  });

  it('shows on the pause legend as C: change view', () => {
    expect(DEFAULT_KEY_MAP.cycleCamera).toEqual(['KeyC']);
    expect(keyLegend().find((r) => r.action === 'change view')?.keys).toBe('C');
  });
});
