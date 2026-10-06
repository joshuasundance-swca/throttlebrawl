// The keyboard (docs/product-spec.md, "Keyboard (equal priority)"). Keys are KeyboardEvent.code
// values, so the map follows key positions on any layout. Esc (pause) and Backquote (the tuning
// panel) belong to ui/. C cycles the camera view (camera-3; the integration round): the cruise
// action stays reserved and unbuilt [decided], and gets its own key if a playtest asks for it.
//
// The wheelie (playtest 4, P4-7: the touch button's model at parity) is a held key: H, under the right
// index finger beside J, as the touch button sits beside the attack button under the right thumb. Hold
// to lift the front and keep it up, release to drop it; W stays the throttle and S brings the nose
// down. Playtest 3's tap-then-hold of W is gone. Not Shift: five quick presses of Shift (the
// hold-and-release rhythm) open the Sticky Keys prompt on Windows.
//
// Remapping (the maintainer, 2026-10-05: "on computer drifting is a bit less than ideal because the
// brake is the s key"): every action here has its keys in Settings, Keys (input/bindings.ts turns the
// saved record into a KeyMap). Space joins S and Down as a brake, so a drift (brake, steer and
// throttle at once) is the left thumb on Space with W and A or D, or the arrows with Space; Space
// still skips the run-back on foot, which never clashes with braking. Q is the U-turn button: hold it
// and steer the way round (input/uturn-macro.ts). Esc always pauses; the pause row takes more keys.
import type { ActionState } from '../actions';
import { UturnMacro } from '../uturn-macro';

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
  | 'cycleCamera'
  | 'wheelie'
  | 'uturn'
  | 'pause';

export type KeyMap = Readonly<Record<KeyAction, readonly string[]>>;

/** The product spec's keyboard map. Every key is remappable [default]: pass another KeyMap. */
export const DEFAULT_KEY_MAP: KeyMap = {
  throttle: ['KeyW', 'ArrowUp'],
  // Space as a second brake under the left thumb (2026-10-05, for the drift). [default]
  brake: ['KeyS', 'ArrowDown', 'Space'],
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
  // Playtest 4's wheelie button: hold H. [default]
  wheelie: ['KeyH'],
  // The U-turn button: hold Q and steer the way round (2026-10-05). [default]
  uturn: ['KeyQ'],
  // Esc always pauses (ui/ owns the key); more keys can be added in Settings, Keys.
  pause: ['Escape'],
};

/** What each key action does, in player words, for the pause screen's legend (playtest 1). */
export const KEY_ACTION_NAMES: Readonly<Record<KeyAction, string>> = {
  throttle: 'ride',
  brake: 'brake / drift (with steer)',
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
  wheelie: 'wheelie (hold)',
  uturn: 'U-turn (hold, steer round)',
  pause: 'pause',
};

/** The legend's order: riding first, then fighting, then the rest. */
const LEGEND_ORDER: readonly KeyAction[] = [
  'throttle',
  'brake',
  'steerLeft',
  'steerRight',
  'wheelie',
  'uturn',
  'kick',
  'kickStraight',
  'attack',
  'attackLeft',
  'attackRight',
  'lookBack',
  'cycleCamera',
  'skipRunBack',
  'pause',
];

const ARROWS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

const NAMED: Readonly<Record<string, string>> = {
  Escape: 'Esc',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backspace: 'Bksp',
  CapsLock: 'Caps',
};

/** A key code as printed on the key: `KeyK` is K, `ArrowUp` an arrow, `ShiftLeft` L Shift. */
export function keyLabel(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  const arrow = ARROWS[code];
  if (arrow) return arrow;
  const named = NAMED[code];
  if (named) return named;
  const side = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(code);
  if (side) return `${side[2] === 'Left' ? 'L' : 'R'} ${side[1] === 'Control' ? 'Ctrl' : side[1]}`;
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
  private map: KeyMap;
  private readonly uturnButton = new UturnMacro();

  constructor(map: KeyMap = DEFAULT_KEY_MAP) {
    this.map = map;
  }

  /** Replaces the key map (a remap in the settings); held keys are forgotten. */
  setMap(map: KeyMap): void {
    this.map = map;
    this.clear();
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
    this.uturnButton.clear();
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
    if (this.active('wheelie')) a.wheelie = true;
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
    // The U-turn button last: it writes the brake and the bars (pause is ui's, never sampled here).
    this.uturnButton.apply(a, this.active('uturn'), dt);
    this.pressed.clear();
  }
}
