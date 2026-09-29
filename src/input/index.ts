// input: devices -> one action state -> one quantized SimInput per tick (docs/architecture.md,
// "Input"). The skeleton has the keyboard map from the product spec, a minimal touch layout (a
// floating stick in the left zone, brake and attack buttons from the layout record) and latching,
// so a tap shorter than a tick is never lost. input-1 owns this folder after app-1: the full
// gesture timing, pointer capture polish, the mirror and the device-path tests.
import { InputFlag, placeElement, quantizeInput, type SimInput, type TouchLayout } from '../sim/api';

export interface ActionState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  attack: boolean;
  /** -1 forced left, 1 forced right, 0 auto-target side. */
  attackSide: -1 | 0 | 1;
  kick: boolean;
  lookBack: boolean;
  skipRunBack: boolean;
}

export function emptyActions(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

/** Converts an action state to the quantized command the sim steps on. */
export function toSimInput(a: ActionState): SimInput {
  let flags = 0;
  if (a.attack) flags |= InputFlag.attack;
  if (a.attackSide < 0) flags |= InputFlag.attackSideLeft;
  if (a.attackSide > 0) flags |= InputFlag.attackSideRight;
  if (a.kick) flags |= InputFlag.kick;
  if (a.lookBack) flags |= InputFlag.lookBack;
  if (a.skipRunBack) flags |= InputFlag.skipRunBack;
  return quantizeInput({ steer: a.steer, throttle: a.throttle, brake: a.brake, flags });
}

/** Keys held and presses latched since the last sample. Pure, so it is unit-testable. */
export class KeyboardState {
  private held = new Set<string>();
  private latched = new Set<string>();
  private throttle = 0;

  down(code: string): void {
    if (!this.held.has(code)) this.latched.add(code);
    this.held.add(code);
  }
  up(code: string): void {
    this.held.delete(code);
  }
  clear(): void {
    this.held.clear();
  }
  private is(...codes: string[]): boolean {
    return codes.some((c) => this.held.has(c) || this.latched.has(c));
  }
  /** Writes this tick's keyboard actions into `a` and clears the latches. */
  sample(a: ActionState, dt: number): void {
    // Throttle ramps up while held (product spec, keyboard map), and drops at once on release.
    this.throttle = this.is('KeyW', 'ArrowUp') ? Math.min(1, this.throttle + dt * 3) : 0;
    a.throttle = Math.max(a.throttle, this.throttle);
    if (this.is('KeyS', 'ArrowDown')) a.brake = 1;
    const steer = (this.is('KeyD', 'ArrowRight') ? 1 : 0) - (this.is('KeyA', 'ArrowLeft') ? 1 : 0);
    if (steer !== 0) a.steer = steer;
    if (this.is('KeyJ', 'KeyU', 'KeyO', 'KeyK')) a.attack = true;
    if (this.is('KeyU')) a.attackSide = -1;
    if (this.is('KeyO')) a.attackSide = 1;
    if (this.is('KeyK')) a.kick = true;
    if (this.is('KeyL')) a.lookBack = true;
    if (this.is('Space')) a.skipRunBack = true;
    this.latched.clear();
  }
}

interface StickTouch {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
}

/** Stick travel for full deflection, CSS px. */
const STICK_RANGE_PX = 60;
/** Touches this close to the screen edge are ignored: the phone's back gesture owns them. */
const EDGE_PX = 24;

export interface InputSystem {
  /** Samples this tick's command and clears latched presses. `dt` is the sim step, seconds. */
  sample(dt: number): SimInput;
  /** The action state behind the last sample (for the HUD and the test handle). */
  lastActions(): Readonly<ActionState>;
  /** A driver (the bot) that writes the action state each tick instead of the devices. */
  setDriver(driver: ((a: ActionState) => void) | null): void;
  setLayout(layout: TouchLayout): void;
  dispose(): void;
}

export interface InputOptions {
  /** Where key events arrive (the window). */
  keys: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  /** The full-screen touch surface over the canvas. */
  surface: HTMLElement;
  layout: TouchLayout;
}

export function createInput(opts: InputOptions): InputSystem {
  const keyboard = new KeyboardState();
  let layout = opts.layout;
  let driver: ((a: ActionState) => void) | null = null;
  let stick: StickTouch | null = null;
  const brakes = new Set<number>();
  let attackLatched = false;
  let last = emptyActions();

  const rectOf = (element: string) => {
    const el = layout.elements.find((e) => e.element === element && e.visible);
    const { width, height } = opts.surface.getBoundingClientRect();
    return el ? placeElement(el, width, height, layout.mirror) : null;
  };
  const inside = (r: { x: number; y: number; w: number; h: number } | null, x: number, y: number) =>
    !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  const onKeyDown = (e: Event) => {
    const k = e as KeyboardEvent;
    if (k.code === 'Backquote' || k.code === 'Escape') return; // the tuning panel and pause are ui's
    keyboard.down(k.code);
  };
  const onKeyUp = (e: Event) => keyboard.up((e as KeyboardEvent).code);
  const onBlur = () => keyboard.clear();

  const onPointerDown = (e: PointerEvent) => {
    const box = opts.surface.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    if (x < EDGE_PX || x > box.width - EDGE_PX) return;
    if (inside(rectOf('touch-attack'), x, y)) attackLatched = true;
    else if (inside(rectOf('touch-brake'), x, y)) brakes.add(e.pointerId);
    else if (!stick && inside(rectOf('touch-stick-zone'), x, y))
      stick = { id: e.pointerId, x0: x, y0: y, x, y };
    else return;
    opts.surface.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (stick && e.pointerId === stick.id) {
      const box = opts.surface.getBoundingClientRect();
      stick.x = e.clientX - box.left;
      stick.y = e.clientY - box.top;
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (stick && e.pointerId === stick.id) stick = null; // lift to coast
    brakes.delete(e.pointerId);
  };

  opts.keys.addEventListener('keydown', onKeyDown);
  opts.keys.addEventListener('keyup', onKeyUp);
  opts.keys.addEventListener('blur', onBlur);
  opts.surface.addEventListener('pointerdown', onPointerDown);
  opts.surface.addEventListener('pointermove', onPointerMove);
  opts.surface.addEventListener('pointerup', onPointerUp);
  opts.surface.addEventListener('pointercancel', onPointerUp); // cancel is a release

  return {
    sample(dt) {
      const a = emptyActions();
      if (driver) {
        driver(a);
      } else {
        keyboard.sample(a, dt);
        if (stick) {
          const dx = (stick.x - stick.x0) / STICK_RANGE_PX;
          const up = (stick.y0 - stick.y) / STICK_RANGE_PX;
          a.steer = Math.max(-1, Math.min(1, dx));
          a.throttle = Math.max(a.throttle, Math.max(0, Math.min(1, up)));
        }
        if (brakes.size > 0) a.brake = 1;
        if (attackLatched) a.attack = true;
      }
      attackLatched = false;
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
    dispose() {
      opts.keys.removeEventListener('keydown', onKeyDown);
      opts.keys.removeEventListener('keyup', onKeyUp);
      opts.keys.removeEventListener('blur', onBlur);
      opts.surface.removeEventListener('pointerdown', onPointerDown);
      opts.surface.removeEventListener('pointermove', onPointerMove);
      opts.surface.removeEventListener('pointerup', onPointerUp);
      opts.surface.removeEventListener('pointercancel', onPointerUp);
    },
  };
}
