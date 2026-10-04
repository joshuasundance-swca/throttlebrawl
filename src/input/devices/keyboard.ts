// The keyboard (docs/product-spec.md, "Keyboard (equal priority)"). Keys are KeyboardEvent.code
// values, so the map follows key positions on any layout. Esc (pause) and Backquote (the tuning
// panel) belong to ui/. C cycles the camera view (camera-3; the integration round): the cruise
// action stays reserved and unbuilt [decided], and gets its own key if a playtest asks for it.
//
// The wheelie (playtest 3) is a gesture on the throttle keys: tap W, then press and hold it again
// within input.wheelieTapMs, and `wheelie` is set once the throttle's ramp has passed the sim's 0.3
// floor, until the key lifts. Balance is feathering W (the sim's balance reads the throttle), and S
// brings the nose down. Time is the samples' own dt, so a key event is timed to the tick it lands in.
import type { ActionState } from '../actions';
import { inputDefaults, type InputThresholds } from '../tuning';
import { TapPair, WheelieLatch } from './wheelie-tap';

export type KeyAction =
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
  | 'cycleCamera';

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
  // Playtest 2's straight kick at the rider ahead: I, between U and O. [default]
  kickStraight: ['KeyI'],
  lookBack: ['KeyL'],
  skipRunBack: ['Space'],
  cycleCamera: ['KeyC'],
};

/** What each key action does, in player words, for the pause screen's legend (playtest 1). */
export const KEY_ACTION_NAMES: Readonly<Record<KeyAction, string>> = {
  throttle: 'ride (double-tap: wheelie)',
  brake: 'brake',
  steerLeft: 'steer left',
  steerRight: 'steer right',
  attack: 'punch',
  attackLeft: 'punch left',
  attackRight: 'punch right',
  kick: 'kick (hold U or O: to that side)',
  kickStraight: 'straight kick, at the rider ahead',
  lookBack: 'look back',
  skipRunBack: 'skip the run back',
  cycleCamera: 'change view',
};

/** The legend's order: riding first, then fighting, then the rest. */
const LEGEND_ORDER: readonly KeyAction[] = [
  'throttle',
  'brake',
  'steerLeft',
  'steerRight',
  'kick',
  'kickStraight',
  'attack',
  'attackLeft',
  'attackRight',
  'lookBack',
  'cycleCamera',
  'skipRunBack',
];

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** A key code as printed on the key: `KeyK` is K, `ArrowUp` an arrow, `Escape` Esc. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  const arrow = ARROWS[code];
  if (arrow) return arrow;
  if (code === 'Escape') return 'Esc';
  if (code === 'Backquote') return '`';
  return code;
}

export interface KeyLegendRow {
  /** The action's key labels, joined with " / ". */
  keys: string;
  /** What the keys do. */
  action: string;
}

/**
 * The keyboard legend for the pause screen (playtest 1, 2026-09-30: "idk how to kick on the
 * laptop"), drawn from the key map in use so a remap shows up. It is never shown on the in-race
 * HUD [decided]. Unbound actions are left out.
 */
export function keyLegend(map: KeyMap = DEFAULT_KEY_MAP): KeyLegendRow[] {
  return LEGEND_ORDER.filter((a) => map[a].length > 0).map((a) => ({
    keys: map[a].map(keyLabel).join(' / '),
    action: KEY_ACTION_NAMES[a],
  }));
}

/** Seconds from no throttle to full while the throttle key is held. */
const THROTTLE_RAMP_S = 1 / 3;

/** Keys held, and presses latched since the last sample. Pure, so it is unit-testable. */
export class KeyboardState {
  private readonly held = new Set<string>();
  /** Keys pressed since the last sample (kept even if already released: latching). */
  private readonly pressed = new Set<string>();
  private throttle = 0;
  private readonly map: KeyMap;
  /** The wheelie's double-tap on the throttle keys; `clock` is the samples' own time, seconds. */
  private readonly taps = new TapPair();
  private readonly latch = new WheelieLatch();
  private readonly thresholds: Pick<InputThresholds, 'wheelieTapMs'>;
  private clock = 0;

  /** `thresholds` is read live (createInput hands over its own, so the tuning panel moves it). */
  constructor(
    map: KeyMap = DEFAULT_KEY_MAP,
    thresholds: Pick<InputThresholds, 'wheelieTapMs'> = inputDefaults(),
  ) {
    this.map = map;
    this.thresholds = thresholds;
  }

  /** Whether the map binds this code (the caller may then prevent the browser default). */
  binds(code: string): boolean {
    return Object.values(this.map).some((codes) => codes.includes(code));
  }
  down(code: string): void {
    if (!this.held.has(code)) {
      this.pressed.add(code); // key auto-repeat is not a new press
      // The first throttle key down is a press of the throttle; a second key on top of it is not.
      if (this.map.throttle.includes(code) && !this.throttleHeld())
        this.latch.press(this.taps.press(this.clock, this.windowS()));
    }
    this.held.add(code);
  }
  up(code: string): void {
    const was = this.throttleHeld();
    this.held.delete(code);
    if (was && !this.throttleHeld()) {
      this.taps.lift(this.clock, this.windowS());
      this.latch.release();
    }
  }
  clear(): void {
    this.held.clear();
    this.pressed.clear();
    this.throttle = 0;
    this.taps.reset();
    this.latch.release();
  }
  /** Whether a throttle key is physically down now (a press latched since the last sample is not). */
  private throttleHeld(): boolean {
    return this.map.throttle.some((c) => this.held.has(c));
  }
  private windowS(): number {
    return this.thresholds.wheelieTapMs / 1000;
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
    if (this.latch.sample(this.throttleHeld(), this.throttle)) a.wheelie = true;
    if (this.active('brake')) a.brake = 1;
    const steer = (this.active('steerRight') ? 1 : 0) - (this.active('steerLeft') ? 1 : 0);
    if (steer !== 0) a.steer = steer;
    // Attack is a press edge; the side and the kick are level-held while their key is down.
    if (
      this.pressedNow('attack') ||
      this.pressedNow('attackLeft') ||
      this.pressedNow('attackRight') ||
      this.pressedNow('kick') ||
      this.pressedNow('kickStraight')
    )
      a.attack = true;
    if (this.active('attackLeft')) a.attackSide = -1;
    if (this.active('attackRight')) a.attackSide = 1;
    if (this.active('kick')) a.kick = true;
    if (this.active('kickStraight')) a.kickStraight = true;
    if (this.active('lookBack')) a.lookBack = true;
    if (this.active('skipRunBack')) a.skipRunBack = true;
    if (this.pressedNow('cycleCamera')) a.cycleCamera = true;
    this.pressed.clear();
    this.clock += dt;
  }
}
