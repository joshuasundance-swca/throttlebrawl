// The keyboard (docs/product-spec.md, "Keyboard (equal priority)"). Keys are KeyboardEvent.code
// values, so the map follows key positions on any layout. Esc (pause) and Backquote (the tuning
// panel) belong to ui/; C (cruise) is reserved and not bound [decided].
import type { ActionState } from '../actions';

export type KeyAction =
  | 'throttle'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'attack'
  | 'attackLeft'
  | 'attackRight'
  | 'kick'
  | 'lookBack'
  | 'skipRunBack';

export type KeyMap = Readonly<Record<KeyAction, readonly string[]>>;

/** The product spec's keyboard map. Every key is remappable [default]: pass another KeyMap. */
export const DEFAULT_KEY_MAP: KeyMap = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ'],
  attackLeft: ['KeyU'],
  attackRight: ['KeyO'],
  kick: ['KeyK'],
  lookBack: ['KeyL'],
  skipRunBack: ['Space'],
};

/** Seconds from no throttle to full while the throttle key is held. */
const THROTTLE_RAMP_S = 1 / 3;

/** Keys held, and presses latched since the last sample. Pure, so it is unit-testable. */
export class KeyboardState {
  private readonly held = new Set<string>();
  /** Keys pressed since the last sample (kept even if already released: latching). */
  private readonly pressed = new Set<string>();
  private throttle = 0;
  private readonly map: KeyMap;

  constructor(map: KeyMap = DEFAULT_KEY_MAP) {
    this.map = map;
  }

  /** Whether the map binds this code (the caller may then prevent the browser default). */
  binds(code: string): boolean {
    return Object.values(this.map).some((codes) => codes.includes(code));
  }
  down(code: string): void {
    if (!this.held.has(code)) this.pressed.add(code); // key auto-repeat is not a new press
    this.held.add(code);
  }
  up(code: string): void {
    this.held.delete(code);
  }
  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.throttle = 0;
  }
  /** Held now, or pressed and released since the last sample. */
  private active(action: KeyAction): boolean {
    return this.map[action].some((c) => this.held.has(c) || this.pressed.has(c));
  }
  private pressedNow(action: KeyAction): boolean {
    return this.map[action].some((c) => this.pressed.has(c));
  }

  /** Writes this tick's keyboard actions into `a` and clears the latches. */
  sample(a: ActionState, dt: number): void {
    // Throttle ramps up while held (product spec), and drops at once on release.
    this.throttle = this.active('throttle') ? Math.min(1, this.throttle + dt / THROTTLE_RAMP_S) : 0;
    a.throttle = Math.max(a.throttle, this.throttle);
    if (this.active('brake')) a.brake = 1;
    const steer = (this.active('steerRight') ? 1 : 0) - (this.active('steerLeft') ? 1 : 0);
    if (steer !== 0) a.steer = steer;
    // Attack is a press edge; the side and the kick are level-held while their key is down.
    if (
      this.pressedNow('attack') ||
      this.pressedNow('attackLeft') ||
      this.pressedNow('attackRight') ||
      this.pressedNow('kick')
    )
      a.attack = true;
    if (this.active('attackLeft')) a.attackSide = -1;
    if (this.active('attackRight')) a.attackSide = 1;
    if (this.active('kick')) a.kick = true;
    if (this.active('lookBack')) a.lookBack = true;
    if (this.active('skipRunBack')) a.skipRunBack = true;
    this.pressed.clear();
  }
}
