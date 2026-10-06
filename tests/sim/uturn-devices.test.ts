// Playtest 4, P4-9: the U-turn's own gesture, made on each device (docs/product-spec.md, Controls:
// "The keyboard and gamepad get a form of the gesture at parity"). The gesture is read in the sim from
// the brake and the bars alone, so what this checks is that the real device code turns a thumb, a
// key and a trigger into the inputs the sim reads as one: a tap of the brake, then the second press
// held with the bars at full lock. Each device's tick-by-tick actions go through toSimInput, as the
// loop does, into the riding model on a straight; the same device holding the brake and full lock
// without the tap does not turn the bike round (the old rule did).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAD_MAP,
  emptyActions,
  GamepadState,
  inputDefaults,
  KeyboardState,
  keyMapFromBindings,
  padMapFromBindings,
  toSimInput,
  TouchState,
  type ActionState,
  type PadLike,
  type TouchZones,
} from '../../src/input';
import { riderHarness, testConfig } from '../../src/sim/riders/testing';

/** One device's actions on tick `t`. */
type Device = (t: number) => ActionState;

/** The gesture: a tap on ticks 0 to 5, up until 12, the second press from 12 with full lock to the left. */
const TAP = { down: 0, up: 6, second: 12 };

const ZONES: TouchZones = {
  width: 800,
  height: 400,
  stick: { x: 20, y: 100, w: 300, h: 300 },
  brake: { x: 560, y: 300, w: 100, h: 80 },
  attack: { x: 680, y: 300, w: 100, h: 80 },
};

function touch(withTap: boolean): Device {
  const state = new TouchState(inputDefaults());
  const range = inputDefaults().stickRangePx;
  const BRAKE_FINGER = 2;
  return (t) => {
    // The left thumb lands at rest (centred) and swings to full lock left when the second press is down.
    if (t === 0) state.down(1, 150, 250, 0, ZONES);
    if (withTap && t === TAP.down) state.down(BRAKE_FINGER, 600, 340, t * 16, ZONES);
    if (withTap && t === TAP.up) state.up(BRAKE_FINGER);
    if (t === TAP.second) {
      state.down(BRAKE_FINGER, 600, 340, t * 16, ZONES);
      state.move(1, 150 - range, 250, t * 16);
    }
    const a = emptyActions();
    state.sample(a);
    return a;
  };
}

function keyboard(withTap: boolean): Device {
  const keys = new KeyboardState();
  return (t) => {
    if (withTap && t === TAP.down) keys.down('KeyS');
    if (withTap && t === TAP.up) keys.up('KeyS');
    if (t === TAP.second) {
      keys.down('KeyS');
      keys.down('KeyA');
    }
    const a = emptyActions();
    keys.sample(a, 1 / 60);
    return a;
  };
}

function pad(withTap: boolean): Device {
  const state = new GamepadState();
  const l2 = DEFAULT_PAD_MAP.buttons.brake[0] ?? 6;
  const make = (brake: boolean, stickX: number): PadLike => ({
    connected: true,
    mapping: 'standard',
    axes: [stickX, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) =>
      i === l2 && brake ? { pressed: true, value: 1 } : { pressed: false, value: 0 },
    ),
  });
  return (t) => {
    const brake = (withTap && t >= TAP.down && t < TAP.up) || t >= TAP.second;
    const a = emptyActions();
    state.sample(a, [make(brake, t >= TAP.second ? -1 : 0)], 0.1);
    return a;
  };
}

function ride(device: Device): { dir: number; maxYaw: number } {
  const h = riderHarness(testConfig(), { s: 400, d: 3, speed: 8 });
  let maxYaw = 0;
  for (let t = 0; t < 4 * 60; t++) {
    h.step(toSimInput(device(t)));
    maxYaw = Math.max(maxYaw, Math.abs(h.rider.yaw));
  }
  return { dir: h.rider.pos.dir, maxYaw };
}

describe('the U-turn gesture on each device (playtest 4, P4-9)', () => {
  const devices: Record<string, (withTap: boolean) => Device> = {
    'touch (the brake button and the stick)': touch,
    'keyboard (S, then S and A)': keyboard,
    'gamepad (L2, then L2 and the stick)': pad,
  };

  for (const [name, make] of Object.entries(devices)) {
    it(`${name}: a tap, then the second press held at full lock, turns the bike round`, () => {
      expect(ride(make(true)).dir).toBe(-1);
    });

    it(`${name}: the brake held at full lock with no tap never does (the old rule)`, () => {
      const run = ride(make(false));
      expect(run.dir).toBe(1);
      expect(run.maxYaw).toBeLessThanOrEqual(1.2);
    });
  }
});

// The U-turn button (2026-10-05, remappable controls): a key or pad button that makes the same
// double tap for the player, so holding it and steering turns the bike round. It reaches the sim as
// the brake and the bars only, the inputs a replay already records.
describe('the U-turn button on the keyboard and the pad (2026-10-05)', () => {
  function uturnKey(code: string, steerFirst: boolean, keys = new KeyboardState()): Device {
    return (t) => {
      if (steerFirst && t === 0) keys.down('KeyA');
      if (t === TAP.second) {
        keys.down(code);
        if (!steerFirst) keys.down('KeyA');
      }
      const a = emptyActions();
      keys.sample(a, 1 / 60);
      return a;
    };
  }

  function uturnPad(button: number, map = DEFAULT_PAD_MAP): Device {
    const state = new GamepadState(map);
    return (t) => {
      const pad: PadLike = {
        connected: true,
        mapping: 'standard',
        axes: [t >= TAP.second ? -1 : 0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, i) =>
          i === button && t >= TAP.second ? { pressed: true, value: 1 } : { pressed: false, value: 0 },
        ),
      };
      const a = emptyActions();
      state.sample(a, [pad], 0.1, 1 / 60);
      return a;
    };
  }

  it('Q held with A turns the bike round', () => {
    expect(ride(uturnKey('KeyQ', false)).dir).toBe(-1);
  });

  it('Q pressed while A is already held turns it round too (the button straightens the bars for its tap)', () => {
    expect(ride(uturnKey('KeyQ', true)).dir).toBe(-1);
  });

  it('a remapped U-turn key does it, through the saved record; the old key then does not', () => {
    const remapped = () => new KeyboardState(keyMapFromBindings({ uturn: ['KeyE'] }));
    expect(ride(uturnKey('KeyE', false, remapped())).dir).toBe(-1);
    expect(ride(uturnKey('KeyQ', false, remapped())).dir).toBe(1);
  });

  it('d-pad down held with the stick turns it round; a remapped button does too', () => {
    expect(ride(uturnPad(DEFAULT_PAD_MAP.buttons.uturn[0] ?? -1)).dir).toBe(-1);
    expect(ride(uturnPad(4, padMapFromBindings({ uturn: ['button4'] }))).dir).toBe(-1);
  });
});
