// input: devices -> one action state -> one quantized SimInput per tick (docs/architecture.md,
// "Input"; docs/milestones/M1.md, "input-1"). Touch (the floating stick, the brake and the attack
// button with its side drag and swipe-down kick) and the keyboard write into one ActionState; the
// app samples it once per sim tick. Presses are latched until a tick samples them. The left-handed
// mirror comes from the layout record. Tilt is a seam. Gamepad and haptics arrive in M2.
import { placeElement, type SimInput, type TouchLayout } from '../sim/api';
import { emptyActions, toSimInput, type ActionState } from './actions';
import { KeyboardState, type KeyMap } from './devices/keyboard';
import type { TiltSource } from './devices/tilt';
import { TouchState, type TouchZones } from './devices/touch';
import { applyInputParam, inputDefaults, type InputThresholds } from './tuning';

export { emptyActions, toSimInput, type ActionState } from './actions';
export { DEFAULT_KEY_MAP, KeyboardState, type KeyAction, type KeyMap } from './devices/keyboard';
export { EDGE_PX, TouchState, type TouchZones } from './devices/touch';
export type { TiltSource } from './devices/tilt';
export { gestureTimingProblems, gestureWindowTicks, type WindupEntry } from './gesture';
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
  /** Tilt steering, added to the thumb (null switches it off). */
  setTilt(source: TiltSource | null): void;
  dispose(): void;
}

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
}

interface PointerLike {
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  preventDefault(): void;
}

export function createInput(opts: InputOptions): InputSystem {
  const thresholds: InputThresholds = inputDefaults();
  const keyboard = new KeyboardState(opts.keyMap);
  const touch = new TouchState(thresholds);
  const { surface } = opts;
  let layout = opts.layout;
  let driver: ((a: ActionState) => void) | null = null;
  let tilt: TiltSource | null = null;
  let last = emptyActions();

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
      } else {
        keyboard.sample(a, dt);
        touch.sample(a);
        const tiltSteer = tilt?.steer() ?? null;
        if (tiltSteer !== null) a.steer = Math.max(-1, Math.min(1, a.steer + tiltSteer));
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
      tilt = source;
    },
    dispose() {
      for (const [type, fn] of keyEvents) opts.keys.removeEventListener(type, fn);
      for (const [type, fn] of pointerEvents) surface.removeEventListener(type, fn);
    },
  };
}
