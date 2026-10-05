// The gamepad (docs/milestones/M2.md, "input-2"; docs/product-spec.md, "Gamepad"). The Gamepad
// API is poll-only, so createInput polls it once per sim tick (at 60 Hz, once per frame) and this
// class turns the pads it sees into the action state. Pure: it takes plain pad records, so it is
// unit-testable without a browser.
//
// Default bindings use the W3C `standard` mapping (a PS4-style pad on the `standard` layout):
// left stick steers, R2 throttles, L2 brakes, Cross attacks with the auto-target side, Square and
// Circle attack forced left and right, Triangle kicks (with Square or Circle held, to that side),
// L1 is the straight kick at the rider ahead (playtest 2's directional kick), R1 looks back. Cross also asks to skip the
// run-back, as the touch attack button does. Every binding is remappable [default]: pass another
// GamepadMap. Whether a PS4 pad reports `standard` on Android Chrome is (unverified) until the
// phone check; a pad with another mapping is read with the same indices.
//
// The wheelie (playtest 4, P4-7: the touch button's model at parity) is a held button: R3, a click
// of the right stick under the right thumb, as the touch button is under the right thumb. Hold to lift
// the front and keep it up, release to drop it; R2 stays the throttle. Playtest 3's double pull of R2
// is gone.
import type { ActionState } from '../actions';

/** The parts of a Gamepad this device reads (a real Gamepad satisfies it). */
export interface PadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

export type PadButtonAction =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'attack'
  | 'attackLeft'
  | 'attackRight'
  | 'kick'
  | 'kickStraight'
  | 'lookBack'
  | 'skipRunBack'
  | 'cycleCamera'
  | 'wheelie';

export interface GamepadMap {
  /** The stick axis that steers (-1 left .. 1 right). */
  readonly steerAxis: number;
  /** The axis read with steerAxis for the radial dead zone (the same stick's other axis). */
  readonly steerAxisPair: number;
  /** Button indices per action; analog buttons (the triggers) give their value. */
  readonly buttons: Readonly<Record<PadButtonAction, readonly number[]>>;
}

/** Standard-mapping button indices. */
export const PAD = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  dpadUp: 12,
  dpadDown: 13,
  dpadLeft: 14,
  dpadRight: 15,
} as const;

export const DEFAULT_PAD_MAP: GamepadMap = {
  steerAxis: 0,
  steerAxisPair: 1,
  buttons: {
    throttle: [PAD.r2],
    brake: [PAD.l2],
    steerLeft: [PAD.dpadLeft],
    steerRight: [PAD.dpadRight],
    attack: [PAD.cross],
    attackLeft: [PAD.square],
    attackRight: [PAD.circle],
    kick: [PAD.triangle],
    kickStraight: [PAD.l1],
    lookBack: [PAD.r1],
    skipRunBack: [PAD.cross],
    // The camera's next view: d-pad up, free in the default map [default].
    cycleCamera: [PAD.dpadUp],
    // Playtest 4's wheelie button: hold R3, free in the default map [default].
    wheelie: [PAD.r3],
  },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const PAD_ACTIONS = Object.keys(DEFAULT_PAD_MAP.buttons) as PadButtonAction[];
const MAX_INDEX = 63;

/**
 * The saved remaps (settings `gamepadBindings`: action id to control tokens) as a GamepadMap.
 * Tokens are `button<N>` for a button action and `axis<N>` for `steer` (the stick's other axis is
 * its pair: 0 with 1, 2 with 3). Only listed actions change; an action whose tokens are all unknown
 * keeps its default, so a bad record never leaves an action unbound.
 */
export function padMapFromBindings(
  bindings: Readonly<Record<string, readonly string[]>>,
  base: GamepadMap = DEFAULT_PAD_MAP,
): GamepadMap {
  const index = (token: string, kind: 'button' | 'axis'): number | null => {
    const m = new RegExp(`^${kind}(\\d{1,2})$`).exec(token);
    const n = m ? Number(m[1]) : NaN;
    return Number.isInteger(n) && n <= MAX_INDEX ? n : null;
  };
  const buttons = { ...base.buttons };
  for (const action of PAD_ACTIONS) {
    const tokens: unknown = bindings[action];
    if (!Array.isArray(tokens)) continue;
    const got = (tokens as unknown[])
      .map((t) => (typeof t === 'string' ? index(t, 'button') : null))
      .filter((n): n is number => n !== null);
    if (got.length > 0) buttons[action] = got;
  }
  let { steerAxis, steerAxisPair } = base;
  const axis = (bindings['steer'] ?? []).map((t) => index(t, 'axis')).find((n) => n !== null);
  if (axis !== undefined && axis !== null) {
    steerAxis = axis;
    steerAxisPair = axis % 2 === 0 ? axis + 1 : axis - 1;
  }
  return { steerAxis, steerAxisPair, buttons };
}

/** Tracks pads between polls, for press edges. */
export class GamepadState {
  private map: GamepadMap;
  /** Whether each press-edge action was held at the last poll. */
  private wasHeld = new Set<PadButtonAction>();
  /** Whether the view button was held at the last poll (its press edge). */
  private viewHeld = false;

  constructor(map: GamepadMap = DEFAULT_PAD_MAP) {
    this.map = map;
  }

  /** Replaces the bindings (a remap in the settings). */
  setMap(map: GamepadMap): void {
    this.map = map;
  }

  /** Forgets held buttons (the window lost focus), so the next press is a fresh edge. */
  clear(): void {
    this.wasHeld.clear();
    this.viewHeld = false;
  }

  /**
   * Writes this poll's gamepad actions into `a`. Every connected pad counts; `deadZone` is the
   * radial stick dead zone as a fraction of full deflection. `_dt`, the seconds since the last poll,
   * is unused since the wheelie's double pull of R2 went (playtest 4); callers still pass it.
   */
  sample(
    a: ActionState,
    pads: readonly (PadLike | null | undefined)[],
    deadZone: number,
    _dt?: number,
  ): void {
    const live = pads.filter((p): p is PadLike => !!p && p.connected);
    const value = (action: PadButtonAction) => {
      let v = 0;
      for (const p of live)
        for (const i of this.map.buttons[action]) {
          const b = p.buttons[i];
          if (b) v = Math.max(v, b.pressed ? Math.max(b.value, 0.5) : b.value);
        }
      return clamp(v, 0, 1);
    };
    const held = (action: PadButtonAction) => value(action) >= 0.5;

    // The stick, with a radial dead zone rescaled so steering starts from zero at its edge.
    let steer = 0;
    for (const p of live) {
      const x = p.axes[this.map.steerAxis] ?? 0;
      const y = p.axes[this.map.steerAxisPair] ?? 0;
      const mag = Math.hypot(x, y);
      if (mag <= deadZone || mag === 0) continue;
      const scaled = (Math.min(1, mag) - deadZone) / (1 - deadZone);
      const s = (x / mag) * scaled;
      if (Math.abs(s) > Math.abs(steer)) steer = s;
    }
    const digital = (held('steerRight') ? 1 : 0) - (held('steerLeft') ? 1 : 0);
    if (digital !== 0) steer = digital;
    if (steer !== 0) a.steer = clamp(steer, -1, 1);

    a.throttle = Math.max(a.throttle, value('throttle'));
    a.brake = Math.max(a.brake, value('brake'));
    if (held('wheelie')) a.wheelie = true;

    // Attack is a press edge (any attack button, or the kick); side and kick are level-held.
    const now = new Set<PadButtonAction>();
    for (const action of ['attack', 'attackLeft', 'attackRight', 'kick', 'kickStraight'] as const)
      if (held(action)) now.add(action);
    for (const action of now) if (!this.wasHeld.has(action)) a.attack = true;
    this.wasHeld = now;
    if (held('attackLeft')) a.attackSide = -1;
    if (held('attackRight')) a.attackSide = 1;
    if (held('kick')) a.kick = true;
    if (held('kickStraight')) a.kickStraight = true;
    if (held('lookBack')) a.lookBack = true;
    if (held('skipRunBack')) a.skipRunBack = true;
    const view = held('cycleCamera');
    if (view && !this.viewHeld) a.cycleCamera = true;
    this.viewHeld = view;
  }
}
