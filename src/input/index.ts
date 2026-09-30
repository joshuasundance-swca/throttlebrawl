// input: devices -> one action state -> one quantized SimInput per tick (docs/architecture.md,
// "Input"; docs/milestones/M1.md, "input-1"). Touch (the floating stick, the brake and the attack
// button with its side drag and swipe-down kick) and the keyboard write into one ActionState; the
// app samples it once per sim tick. Presses are latched until a tick samples them. The left-handed
// mirror comes from the layout record.
// M2 input-2 (docs/milestones/M2.md): the gamepad (polled on every sample), tilt steering as an
// option (thumb, tilt, or both added together), auto-throttle and pull-back brake as options, and
// haptics (input/feedback) fed the player's sim events.
import type { EntityId } from '../core';
import { placeElement, type SimEvent, type SimInput, type TouchLayout } from '../sim/api';
import { emptyActions, toSimInput, type ActionState } from './actions';
import {
  DEFAULT_PAD_MAP,
  GamepadState,
  padMapFromBindings,
  type GamepadMap,
  type PadLike,
} from './devices/gamepad';
import { KeyboardState, type KeyMap } from './devices/keyboard';
import { browserScreenAngle, createTilt, type TiltSource } from './devices/tilt';
import { TouchState, type TouchZones } from './devices/touch';
import { createHaptics, type Haptics, type VibrateFn } from './feedback';
import { applyInputParam, inputDefaults, type InputThresholds } from './tuning';

export { emptyActions, toSimInput, type ActionState } from './actions';
export {
  DEFAULT_PAD_MAP,
  GamepadState,
  PAD,
  padMapFromBindings,
  type GamepadMap,
  type PadButtonAction,
  type PadLike,
} from './devices/gamepad';
export { DEFAULT_KEY_MAP, KeyboardState, type KeyAction, type KeyMap } from './devices/keyboard';
export {
  createTilt,
  tiltAngleFromEuler,
  tiltAngleFromGravity,
  TiltState,
  type GravityReading,
  type TiltSource,
} from './devices/tilt';
export { EDGE_PX, TouchState, type TouchZones } from './devices/touch';
export {
  createHaptics,
  HAPTIC_PATTERNS,
  hapticKind,
  hapticPattern,
  type HapticKind,
  type Haptics,
  type VibrateFn,
} from './feedback';
export { gestureTimingProblems, gestureWindowTicks, kickConvertTicks, type WindupEntry } from './gesture';
export { applyInputParam, INPUT_TUNING, inputDefaults, type InputThresholds } from './tuning';

export interface InputSystem {
  /** Samples this tick's command and clears latched presses. `dt` is the sim step, seconds. */
  sample(dt: number): SimInput;
  /** The action state behind the last sample (for the HUD and the test handle). */
  lastActions(): Readonly<ActionState>;
  /** A driver (the bot) that writes the action state each tick instead of the devices. */
  setDriver(driver: ((a: ActionState) => void) | null): void;
  /** The touch layout record, including the left-handed mirror. */
  setLayout(layout: TouchLayout): void;
  /** Applies an `input.*` tuning value (INPUT_TUNING); other ids are ignored. */
  setParam(id: string, value: number): void;
  /**
   * An injected tilt device (tests, or another source). It replaces the browser's motion sensors
   * and is used whatever the steering method: added to the thumb, or alone when steering is
   * 'tilt'. Null goes back to the browser's sensors, which run only when steering is not 'thumb'.
   */
  setTilt(source: TiltSource | null): void;
  /** Changes the control options (settings); options not named keep their value. */
  setOptions(options: Partial<ControlOptions>): void;
  options(): Readonly<ControlOptions>;
  /** Makes the phone's current tilt the straight-ahead angle (every race start). */
  calibrateTilt(): void;
  /** The haptics output (whether the browser can vibrate, the toggle); onEvents feeds it. */
  readonly haptics: Haptics;
  /** One sim step's events: buzzes for the local player's hits, takedowns and crashes. */
  onEvents(events: readonly SimEvent[], playerId: EntityId): void;
  dispose(): void;
}

/** How the player steers (M2 input-2). Thumb is the starting default [default]; playtests decide. */
export type SteeringMethod = 'thumb' | 'tilt' | 'both';

/** The control settings input-2 adds, all per device. */
export interface ControlOptions {
  steering: SteeringMethod;
  /** Tilt sensitivity: 1 is full steer at input.tiltFullLockDeg; 2 needs half the tilt. */
  tiltSensitivity: number;
  /** Full throttle whenever the player is not braking. */
  autoThrottle: boolean;
  /** Pulling the touch stick down brakes. Off until a playtest decides the default. */
  pullBackBrake: boolean;
  /** Vibration on hits, takedowns and crashes. On by default [decided]. */
  haptics: boolean;
  /**
   * Gamepad remaps from the settings (`gamepadBindings`): action id to tokens such as `button3`,
   * or `axis2` for `steer`. Only remapped actions are listed; {} means the default bindings.
   */
  padBindings: Readonly<Record<string, readonly string[]>>;
}

export const DEFAULT_CONTROL_OPTIONS: Readonly<ControlOptions> = Object.freeze({
  steering: 'thumb',
  tiltSensitivity: 1,
  autoThrottle: false,
  pullBackBrake: false,
  haptics: true,
  padBindings: Object.freeze({}),
});

type Listener = (e: Event) => void;
type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** The play surface: an element over the canvas that receives the touches. */
export interface InputSurface extends Listenable {
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  setPointerCapture?(pointerId: number): void;
  style?: { touchAction: string; pointerEvents: string };
}

export interface InputOptions {
  /** Where key events arrive (the window). */
  keys: Listenable;
  /** The full-screen touch surface over the canvas. */
  surface: InputSurface;
  layout: TouchLayout;
  /** Remapped keys; the product spec's map by default. */
  keyMap?: KeyMap;
  /** Remapped gamepad buttons; the standard-mapping defaults otherwise. */
  padMap?: GamepadMap;
  /** The connected pads, polled once per sample; navigator.getGamepads by default. */
  gamepads?: () => readonly (PadLike | null | undefined)[];
  /** Where devicemotion and deviceorientation arrive; `keys` (the window) by default. */
  motion?: Listenable;
  /** The screen's orientation angle, degrees; screen.orientation.angle by default. */
  screenAngle?: () => number;
  /** The vibrate call; navigator.vibrate by default, null for none. */
  vibrate?: VibrateFn | null;
  /** The starting control options. */
  controls?: Partial<ControlOptions>;
}

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  preventDefault(): void;
}

const browserGamepads = (): readonly (PadLike | null)[] => {
  const nav = (globalThis as { navigator?: { getGamepads?: () => readonly (PadLike | null)[] } }).navigator;
  if (typeof nav?.getGamepads !== 'function') return [];
  try {
    return nav.getGamepads() ?? [];
  } catch {
    return []; // a permissions policy can forbid the Gamepad API
  }
};

export function createInput(opts: InputOptions): InputSystem {
  const thresholds: InputThresholds = inputDefaults();
  const keyboard = new KeyboardState(opts.keyMap);
  const touch = new TouchState(thresholds);
  const padBase = opts.padMap ?? DEFAULT_PAD_MAP;
  const gamepad = new GamepadState(padBase);
  let padBindings: ControlOptions['padBindings'] | null = null;
  const readPads = opts.gamepads ?? browserGamepads;
  const haptics = createHaptics(opts.vibrate === undefined ? {} : { vibrate: opts.vibrate });
  let controls: ControlOptions = { ...DEFAULT_CONTROL_OPTIONS, ...opts.controls };
  const { surface } = opts;
  let layout = opts.layout;
  let driver: ((a: ActionState) => void) | null = null;
  let last = emptyActions();

  /** An injected tilt device (setTilt), or null for the browser's sensors. */
  let injectedTilt: TiltSource | null = null;
  /** The browser's sensors, listening only while the steering method uses tilt. */
  let sensorTilt: ReturnType<typeof createTilt> | null = null;
  const applyControls = () => {
    touch.options.stickSteers = controls.steering !== 'tilt';
    touch.options.pullBackBrake = controls.pullBackBrake;
    haptics.setEnabled(controls.haptics);
    if (controls.padBindings !== padBindings) {
      padBindings = controls.padBindings;
      gamepad.setMap(padMapFromBindings(padBindings, padBase));
    }
    const wantSensors = controls.steering !== 'thumb' && !injectedTilt;
    if (wantSensors && !sensorTilt)
      sensorTilt = createTilt(opts.motion ?? opts.keys, thresholds, opts.screenAngle ?? browserScreenAngle);
    if (!wantSensors && sensorTilt) {
      sensorTilt.dispose();
      sensorTilt = null;
    }
    if (sensorTilt) sensorTilt.sensitivity = controls.tiltSensitivity;
  };
  applyControls();

  // The play surface must receive touches: no browser panning or zooming on it, and pointer
  // events on even when an overlay parent turns them off (ui's #ui root has pointer-events none).
  if (surface.style) {
    surface.style.touchAction = 'none';
    surface.style.pointerEvents = 'auto';
  }

  const zones = (box: { width: number; height: number }): TouchZones => {
    const rect = (element: string) => {
      const el = layout.elements.find((e) => e.element === element && e.visible);
      return el ? placeElement(el, box.width, box.height, layout.mirror) : null;
    };
    return {
      width: box.width,
      height: box.height,
      stick: rect('touch-stick-zone'),
      brake: rect('touch-brake'),
      attack: rect('touch-attack'),
    };
  };

  const onKeyDown: Listener = (e) => {
    const k = e as KeyboardEvent;
    if (k.code === 'Backquote' || k.code === 'Escape') return; // the tuning panel and pause are ui's
    keyboard.down(k.code);
  };
  const onKeyUp: Listener = (e) => keyboard.up((e as KeyboardEvent).code);
  const onBlur: Listener = () => {
    keyboard.clear();
    touch.clear();
    gamepad.clear();
  };

  const onPointerDown: Listener = (e) => {
    const p = e as unknown as PointerLike;
    const box = surface.getBoundingClientRect();
    const got = touch.down(p.pointerId, p.clientX - box.left, p.clientY - box.top, p.timeStamp, zones(box));
    if (!got) return;
    try {
      surface.setPointerCapture?.(p.pointerId);
    } catch {
      // No active pointer with that id (a synthetic event): capture is a nicety, not a need.
    }
    p.preventDefault();
  };
  const onPointerMove: Listener = (e) => {
    const p = e as unknown as PointerLike;
    const box = surface.getBoundingClientRect();
    touch.move(p.pointerId, p.clientX - box.left, p.clientY - box.top, p.timeStamp);
  };
  // pointerup, pointercancel and a lost capture are all a release.
  const onPointerUp: Listener = (e) => touch.up((e as unknown as PointerLike).pointerId);

  const pointerEvents: [string, Listener][] = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['pointercancel', onPointerUp],
    ['lostpointercapture', onPointerUp],
  ];
  const keyEvents: [string, Listener][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['blur', onBlur],
  ];
  for (const [type, fn] of keyEvents) opts.keys.addEventListener(type, fn);
  for (const [type, fn] of pointerEvents) surface.addEventListener(type, fn);

  return {
    sample(dt) {
      const a = emptyActions();
      if (driver) {
        driver(a);
        // The devices' latches still drain, so a press made while the bot drove does not leak.
        keyboard.sample(emptyActions(), dt);
        touch.sample(emptyActions());
        gamepad.sample(emptyActions(), readPads(), thresholds.gamepadDeadZone);
      } else {
        keyboard.sample(a, dt);
        touch.sample(a);
        gamepad.sample(a, readPads(), thresholds.gamepadDeadZone);
        const tiltSteer = (injectedTilt ?? sensorTilt)?.steer(dt) ?? null;
        if (tiltSteer !== null) a.steer = Math.max(-1, Math.min(1, a.steer + tiltSteer));
        // Auto-throttle: full throttle unless braking, so the brake still stops the bike.
        if (controls.autoThrottle && a.brake === 0) a.throttle = 1;
      }
      last = a;
      return toSimInput(a);
    },
    lastActions: () => last,
    setDriver(d) {
      driver = d;
    },
    setLayout(l) {
      layout = l;
    },
    setParam(id, value) {
      applyInputParam(thresholds, id, value);
    },
    setTilt(source) {
      injectedTilt = source;
      applyControls();
    },
    setOptions(next) {
      controls = { ...controls, ...next };
      applyControls();
    },
    options: () => controls,
    calibrateTilt() {
      (injectedTilt ?? sensorTilt)?.calibrate?.();
    },
    haptics,
    onEvents(events, playerId) {
      haptics.onEvents(events, playerId);
    },
    dispose() {
      sensorTilt?.dispose();
      sensorTilt = null;
      for (const [type, fn] of keyEvents) opts.keys.removeEventListener(type, fn);
      for (const [type, fn] of pointerEvents) surface.removeEventListener(type, fn);
    },
  };
}
