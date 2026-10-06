// Control remapping (the maintainer, 2026-10-05: "can we customize keyboard settings and stuff? I want
// to be sure it's a joy to play and use all functions"). Settings, Keys lists every action with its
// keys and its pad buttons; the settings record keeps only what the player changed (`keyBindings`
// and `gamepadBindings`: action id to tokens, key codes such as `KeyQ` or pad tokens such as
// `button3` and `axis2`). This file is the pure half: the rows, the saved record to a KeyMap, the
// conflicts, one slot's change and the labels. Remapping is input only: the devices write the same
// action state, so the sim and replays see the same SimInput. The phone's touch controls are not
// remapped. [default]
import { DEFAULT_PAD_MAP, padMapFromBindings, PAD, type GamepadMap } from './devices/gamepad';
import { DEFAULT_KEY_MAP, keyLabel, type KeyAction, type KeyMap } from './devices/keyboard';

export type Bindings = Readonly<Record<string, readonly string[]>>;
export type BindDevice = 'keyboard' | 'gamepad';
/** A remappable action: the key actions, plus the pad's steering stick. */
export type BindAction = KeyAction | 'steer';

export interface BindRow {
  action: BindAction;
  /** The row's name on the settings screen. */
  label: string;
  /** Whether the row has keyboard slots, pad slots. */
  keyboard: boolean;
  gamepad: boolean;
}

/** Every remappable action, in the settings screen's order: riding, then fighting, then the rest. */
export const BIND_ROWS: readonly BindRow[] = [
  { action: 'steer', label: 'Steer (stick)', keyboard: false, gamepad: true },
  { action: 'steerLeft', label: 'Steer left', keyboard: true, gamepad: true },
  { action: 'steerRight', label: 'Steer right', keyboard: true, gamepad: true },
  { action: 'throttle', label: 'Throttle', keyboard: true, gamepad: true },
  { action: 'brake', label: 'Brake (and drift)', keyboard: true, gamepad: true },
  { action: 'uturn', label: 'U-turn (hold)', keyboard: true, gamepad: true },
  { action: 'wheelie', label: 'Wheelie (hold)', keyboard: true, gamepad: true },
  { action: 'attack', label: 'Punch', keyboard: true, gamepad: true },
  { action: 'attackLeft', label: 'Left (punch, kick)', keyboard: true, gamepad: true },
  { action: 'attackRight', label: 'Right (punch, kick)', keyboard: true, gamepad: true },
  { action: 'kick', label: 'Kick', keyboard: true, gamepad: true },
  { action: 'kickStraight', label: 'Straight kick', keyboard: true, gamepad: true },
  { action: 'lookBack', label: 'Look back', keyboard: true, gamepad: true },
  { action: 'cycleCamera', label: 'Change view', keyboard: true, gamepad: true },
  { action: 'pause', label: 'Pause', keyboard: true, gamepad: true },
  { action: 'skipRunBack', label: 'Skip run back', keyboard: true, gamepad: true },
];

/** How many bindings a row holds on each device (the steering stick holds one axis). */
export function bindSlots(device: BindDevice, action: BindAction): number {
  if (device === 'keyboard') return 3;
  return action === 'steer' ? 1 : 2;
}

/** The key that always pauses (ui/ owns it); it can't be bound to anything else. */
export const PAUSE_KEY = 'Escape';
/** Keys that are never bound: the tuning panel's. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set(['Backquote']);
/** Keys another module reads for itself, by what they do there (audio/'s radio: R). */
export const SHARED_KEYS: Readonly<Record<string, string>> = { KeyR: 'radio station' };
/**
 * Actions that may share a key or button with any other: skipping the run-back only counts while on
 * foot, when nothing else does (the pad's Cross attacks and skips by default).
 */
const SHAREABLE: ReadonlySet<BindAction> = new Set<BindAction>(['skipRunBack']);

const KEY_CODE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const KEY_ACTIONS = Object.keys(DEFAULT_KEY_MAP) as KeyAction[];

/** Whether a key code can be bound to this action. */
export function keyBindable(action: BindAction, code: string): boolean {
  if (!KEY_CODE.test(code) || RESERVED_KEYS.has(code)) return false;
  return code !== PAUSE_KEY || action === 'pause';
}

/**
 * The saved key remaps (settings `keyBindings`) as a KeyMap. Only listed actions change; an action
 * whose tokens are all unusable keeps its default, so a bad record never leaves an action unbound.
 * Esc is always a pause key, and never another action's.
 */
export function keyMapFromBindings(bindings: Bindings, base: KeyMap = DEFAULT_KEY_MAP): KeyMap {
  const out = {} as Record<KeyAction, readonly string[]>;
  for (const action of KEY_ACTIONS) {
    const tokens: unknown = bindings[action];
    const got = Array.isArray(tokens)
      ? [
          ...new Set(
            (tokens as unknown[]).filter((t): t is string => typeof t === 'string' && keyBindable(action, t)),
          ),
        ]
      : [];
    out[action] = got.length > 0 ? got : base[action];
  }
  if (!out.pause.includes(PAUSE_KEY)) out.pause = [PAUSE_KEY, ...out.pause];
  return out;
}

/** The pad's current tokens for an action: `axis<N>` for the stick, `button<N>` for the rest. */
export function padTokens(map: GamepadMap, action: BindAction): string[] {
  if (action === 'steer') return [`axis${map.steerAxis}`];
  return map.buttons[action].map((n) => `button${n}`);
}

/** An action's current tokens on a device, from the saved record. */
export function boundTokens(device: BindDevice, bindings: Bindings, action: BindAction): string[] {
  if (device === 'gamepad') return padTokens(padMapFromBindings(bindings), action);
  return action === 'steer' ? [] : [...keyMapFromBindings(bindings)[action]];
}

/** The default tokens, for the reset and for keeping the saved record to what was changed. */
function defaultTokens(device: BindDevice, action: BindAction): string[] {
  if (device === 'gamepad') return padTokens(DEFAULT_PAD_MAP, action);
  return action === 'steer' ? [] : [...DEFAULT_KEY_MAP[action]];
}

/** Whether a binding is fixed (shown, but not changed or cleared): Esc on pause. */
export function bindingFixed(device: BindDevice, action: BindAction, token: string): boolean {
  return device === 'keyboard' && action === 'pause' && token === PAUSE_KEY;
}

/**
 * The record after one slot's change: `token` into slot `slot` (past the end adds it), or null to
 * clear that slot. A clear never leaves an action with no binding, a fixed binding stays, and an
 * action back at its defaults leaves the record. Returns the same record when nothing changes.
 */
export function withBinding(
  device: BindDevice,
  bindings: Bindings,
  action: BindAction,
  slot: number,
  token: string | null,
): Bindings {
  const current = boundTokens(device, bindings, action);
  const old = current[slot];
  if (old !== undefined && bindingFixed(device, action, old)) return bindings;
  let next = [...current];
  if (token === null) {
    if (old === undefined || current.length <= 1) return bindings;
    next.splice(slot, 1);
  } else {
    if (device === 'keyboard' && !keyBindable(action, token)) return bindings;
    if (device === 'gamepad' && !(action === 'steer' ? /^axis\d{1,2}$/ : /^button\d{1,2}$/).test(token))
      return bindings;
    if (slot < next.length) next[slot] = token;
    else next.push(token);
    next = [...new Set(next)].slice(0, bindSlots(device, action));
  }
  if (next.join() === current.join()) return bindings;
  const out: Record<string, readonly string[]> = { ...bindings };
  if (next.join() === defaultTokens(device, action).join()) delete out[action];
  else out[action] = next;
  return out;
}

export interface BindConflict {
  /** The shared key or button. */
  token: string;
  /** What else it does, as the settings rows (or the other module) name it. */
  others: string[];
}

/**
 * Each action's clashes on a device: a key or button that also does another action (or, for R, the
 * radio). Skipping the run-back shares with anything (it only counts on foot). Empty when clean.
 */
export function bindingConflicts(device: BindDevice, bindings: Bindings): Map<BindAction, BindConflict[]> {
  const rows = BIND_ROWS.filter((r) => r[device]);
  const users = new Map<string, BindAction[]>();
  for (const r of rows)
    for (const t of boundTokens(device, bindings, r.action))
      users.set(t, [...(users.get(t) ?? []), r.action]);
  const label = new Map(rows.map((r) => [r.action, r.label]));
  const out = new Map<BindAction, BindConflict[]>();
  for (const r of rows) {
    for (const token of boundTokens(device, bindings, r.action)) {
      const others: string[] = [];
      if (!SHAREABLE.has(r.action))
        for (const a of users.get(token) ?? [])
          if (a !== r.action && !SHAREABLE.has(a)) others.push(label.get(a) ?? a);
      const shared = device === 'keyboard' ? SHARED_KEYS[token] : undefined;
      if (shared) others.push(shared);
      if (others.length > 0) out.set(r.action, [...(out.get(r.action) ?? []), { token, others }]);
    }
  }
  return out;
}

const PAD_NAMES: Readonly<Record<number, string>> = {
  [PAD.cross]: 'Cross',
  [PAD.circle]: 'Circle',
  [PAD.square]: 'Square',
  [PAD.triangle]: 'Triangle',
  [PAD.l1]: 'L1',
  [PAD.r1]: 'R1',
  [PAD.l2]: 'L2',
  [PAD.r2]: 'R2',
  [PAD.share]: 'Share',
  [PAD.options]: 'Options',
  [PAD.l3]: 'L3',
  [PAD.r3]: 'R3',
  [PAD.dpadUp]: 'D-pad up',
  [PAD.dpadDown]: 'D-pad down',
  [PAD.dpadLeft]: 'D-pad left',
  [PAD.dpadRight]: 'D-pad right',
  16: 'Home',
};

/** A binding as the player reads it: a key cap, a pad button's name, or a stick. */
export function bindingLabel(device: BindDevice, token: string): string {
  if (device === 'keyboard') return keyLabel(token);
  const axis = /^axis(\d+)$/.exec(token);
  if (axis) {
    const n = Number(axis[1]);
    return n === 0 ? 'Left stick' : n === 2 ? 'Right stick' : `Stick axis ${n}`;
  }
  const button = /^button(\d+)$/.exec(token);
  if (button) return PAD_NAMES[Number(button[1])] ?? `Button ${button[1]}`;
  return token;
}
