// Reachability: built is not the same as reachable (the quality retro's recommendation 4, from the
// "built but not reachable" class: the integration round, and the skeptics' "C does nothing (not
// wired)" and "sliders never collected"). Two of its checks live here, where app/ wires the
// modules together; the pack checks are in tools/packs/reachability.test.ts.
//
// 1. Every `*_TUNING` declaration in src/ is collected: each of its ids reaches the tuning registry
//    the panel is built from. Declarations are found by scanning the source, so a new one that
//    nobody spreads into a collector fails here.
// 2. Every key and pad binding has a handler and a settings echo:
//    - handler: pressing it changes the action state, and that change reaches the SimInput or a
//      reader outside input/ (the camera's view key is read by app/);
//    - echo, keys: the pause screen's keyboard legend has a row for it;
//    - echo, pad: a remap saved in the settings record (`gamepadBindings`) moves it, through
//      sanitiseSettings, controlOptionsOf and padMapFromBindings.
// Each check is a plain function, and each is shown to fire on a deliberately broken input.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_MAP,
  DEFAULT_PAD_MAP,
  emptyActions,
  GamepadState,
  KEY_ACTION_NAMES,
  KeyboardState,
  keyLegend,
  padMapFromBindings,
  toSimInput,
  type ActionState,
  type KeyAction,
  type KeyLegendRow,
  type PadButtonAction,
  type PadLike,
} from '../input';
import { DEFAULT_SETTINGS, sanitiseSettings } from '../save';
import type { TuningParamDecl } from '../sim/api';
import { createTuningRegistry } from '../tuning';
import { controlOptionsOf } from './controls';
import { APP_TUNING } from './tuning';

/** Every shipped .ts file under src/ as text, keyed `src/...` (tests and type declarations left out). */
const RAW = import.meta.glob<string>(['/src/**/*.ts', '!/src/**/*.test.ts', '!/src/**/*.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
/** The same files as modules, loaded only when asked (only the declaring files are). */
const MODULES = import.meta.glob(['/src/**/*.ts', '!/src/**/*.test.ts', '!/src/**/*.d.ts']);
const SOURCES = Object.entries(RAW)
  .map(([key, text]) => ({ file: key.slice(1), text }))
  .sort((a, b) => a.file.localeCompare(b.file));

// ---------------------------------------------------------------------------------------------
// 1. Tuning declarations
// ---------------------------------------------------------------------------------------------

/** The `*_TUNING` declarations a source file exports, by name. */
function tuningDeclNames(source: string): string[] {
  return [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*_TUNING)\b/gm)].map((m) => m[1] ?? '');
}

/** `NAME: id` for every declared id the collected list does not have. */
function uncollected(
  declared: Readonly<Record<string, readonly Pick<TuningParamDecl, 'id'>[]>>,
  collected: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const [name, decls] of Object.entries(declared))
    for (const d of decls) if (!collected.has(d.id)) out.push(`${name}: ${d.id}`);
  return out.sort();
}

/** Every `*_TUNING` declaration in src/, imported from the file that declares it. */
async function declaredTuning(): Promise<Record<string, readonly TuningParamDecl[]>> {
  const out: Record<string, readonly TuningParamDecl[]> = {};
  for (const { file, text } of SOURCES) {
    const names = tuningDeclNames(text);
    if (names.length === 0) continue;
    const load = MODULES[`/${file}`];
    if (!load) throw new Error(`${file}: not loadable`);
    const mod = (await load()) as Record<string, unknown>;
    for (const name of names) {
      const list = mod[name];
      if (!Array.isArray(list)) throw new Error(`${file}: ${name} is not a list of declarations`);
      out[`${file}#${name}`] = list as TuningParamDecl[];
    }
  }
  return out;
}

const registryIds = (decls: readonly TuningParamDecl[]) =>
  new Set(createTuningRegistry(decls, () => undefined).decls.map((d) => d.id));

describe('reachability: every *_TUNING declaration is collected into the tuning registry', () => {
  it('each declared id reaches the registry the panel is built from', async () => {
    const declared = await declaredTuning();
    const names = Object.keys(declared);
    const ids = Object.values(declared).reduce((n, l) => n + l.length, 0);
    console.log(`[examined] ${names.length} *_TUNING declarations in src/ (${ids} ids, with overlap)`);
    // The scan must find the known collectors and leaves, or it examined nothing.
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(names.some((n) => n.endsWith('#HUD_TUNING'))).toBe(true);
    expect(uncollected(declared, registryIds(APP_TUNING))).toEqual([]);
  });

  it('fires on a declaration nobody collects (the scan finds it, the check names its ids)', () => {
    const source = [
      "import type { TuningParamDecl } from '../sim/api';",
      'export const ORPHAN_TUNING: readonly TuningParamDecl[] = [];',
      'export const NOT_A_DECL = 1;',
      'const PRIVATE_TUNING = [];',
    ].join('\n');
    expect(tuningDeclNames(source)).toEqual(['ORPHAN_TUNING']);
    const orphan = { ORPHAN_TUNING: [{ id: 'orphan.knob' }] };
    expect(uncollected(orphan, registryIds(APP_TUNING))).toEqual(['ORPHAN_TUNING: orphan.knob']);
  });

  it('fires on the real declarations when one collector drops a module (the HUD left out)', async () => {
    const declared = await declaredTuning();
    const hud = Object.entries(declared).find(([n]) => n.endsWith('#HUD_TUNING'))?.[1] ?? [];
    expect(hud.length).toBeGreaterThan(0);
    const dropped = APP_TUNING.filter((d) => !hud.includes(d));
    const missing = uncollected(declared, registryIds(dropped));
    expect(missing.length).toBeGreaterThanOrEqual(hud.length);
    for (const d of hud)
      expect(
        missing.some((m) => m.endsWith(`: ${d.id}`)),
        d.id,
      ).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Key and pad bindings
// ---------------------------------------------------------------------------------------------

const ACTION_FIELDS = Object.keys({
  ...emptyActions(),
  kickStraight: false,
  cycleCamera: false,
  wheelie: false,
  pause: false,
}) as (keyof ActionState)[];

/** The action-state fields a sample changed from the empty state. */
function changedFields(a: Readonly<ActionState>): (keyof ActionState)[] {
  const empty = emptyActions() as Partial<ActionState>;
  return ACTION_FIELDS.filter((f) => (a[f] ?? false) !== (empty[f] ?? false));
}

/** Whether `field` is read outside input/ (a presentation action never reaches the SimInput). */
function readOutsideInput(field: string, files: readonly { file: string; text: string }[]): boolean {
  const read = new RegExp(`\\.${field}\\b`);
  return files.some((f) => !f.file.startsWith('src/input/') && read.test(f.text));
}

/**
 * Why a binding is not handled, or null. `sample` presses the binding on a fresh device and returns
 * the action state it wrote. Handled means the press changed the state, and every changed field
 * either moves the SimInput or is read outside input/.
 */
function handlerProblem(
  sample: () => ActionState,
  files: readonly { file: string; text: string }[],
): string | null {
  const a = sample();
  const changed = changedFields(a);
  if (changed.length === 0) return 'pressing it changes nothing';
  const reachesSim = JSON.stringify(toSimInput(a)) !== JSON.stringify(toSimInput(emptyActions()));
  if (reachesSim) return null;
  const unread = changed.filter((f) => !readOutsideInput(f, files));
  return unread.length === 0 ? null : `sets ${unread.join(', ')}, which nothing outside input/ reads`;
}

const KEY_ACTIONS = Object.keys(DEFAULT_KEY_MAP) as KeyAction[];
const PAD_ACTIONS = Object.keys(DEFAULT_PAD_MAP.buttons) as PadButtonAction[];

function pressKey(code: string): ActionState {
  const kb = new KeyboardState();
  kb.down(code);
  const a = emptyActions();
  kb.sample(a, 1 / 60);
  return a;
}

function pad(button: number | null, axes: number[] = [0, 0, 0, 0]): PadLike {
  const buttons = Array.from({ length: 64 }, (_, i) => ({
    pressed: i === button,
    value: i === button ? 1 : 0,
  }));
  return { connected: true, mapping: 'standard', axes, buttons };
}

function pressPad(button: number, map = DEFAULT_PAD_MAP): ActionState {
  const gp = new GamepadState(map);
  const a = emptyActions();
  gp.sample(a, [pad(button)], 0.2);
  return a;
}

/** The legend's action names that are missing a row, for the bound actions of `map`. */
function legendGaps(
  actions: readonly KeyAction[],
  legend: readonly KeyLegendRow[],
  names: Readonly<Record<KeyAction, string>>,
): KeyAction[] {
  const shown = new Set(legend.map((r) => r.action));
  return actions.filter((a) => !shown.has(names[a]));
}

/** The pad actions a saved remap (to an unused button) does not move. */
function unremappable(actions: readonly PadButtonAction[]): string[] {
  const out: string[] = [];
  actions.forEach((action, i) => {
    const button = 40 + i;
    const saved = sanitiseSettings({
      ...DEFAULT_SETTINGS,
      gamepadBindings: { [action]: [`button${button}`] },
    });
    const map = padMapFromBindings(controlOptionsOf(saved).padBindings);
    if (!(map.buttons[action] ?? []).includes(button)) out.push(`${action}: the saved remap is lost`);
    else if (changedFields(pressPad(button, map)).length === 0)
      out.push(`${action}: the remapped button does nothing`);
  });
  return out;
}

describe('reachability: every key binding has a handler and a legend row', () => {
  it('each bound key changes the action state, and the change reaches the sim or a reader', () => {
    const problems: string[] = [];
    let keys = 0;
    // The pause keys are ui/'s own (its keydown handler reads the key map's pause row; checked below).
    for (const action of KEY_ACTIONS.filter((a) => a !== 'pause'))
      for (const code of DEFAULT_KEY_MAP[action]) {
        keys++;
        const p = handlerProblem(() => pressKey(code), SOURCES);
        if (p) problems.push(`${action} (${code}): ${p}`);
      }
    console.log(
      `[examined] ${keys} keys over ${KEY_ACTIONS.length} key actions; ${SOURCES.length} src files for readers`,
    );
    expect(keys).toBeGreaterThanOrEqual(KEY_ACTIONS.length - 1);
    expect(problems).toEqual([]);
  });

  it("the pause keys are read by ui/'s key handler, from the player's own key map", () => {
    const ui = SOURCES.filter(
      (f) =>
        f.file.startsWith('src/ui/') &&
        /keyMapFromBindings\([^)]*\)\.pause\.includes\(e\.code\)/.test(f.text),
    );
    expect(ui.map((f) => f.file)).toEqual(['src/ui/index.ts']);
    expect(DEFAULT_KEY_MAP.pause).toContain('Escape');
  });

  it("each key action has a row in the pause screen's keyboard legend, and ui/ draws that legend", () => {
    expect(legendGaps(KEY_ACTIONS, keyLegend(DEFAULT_KEY_MAP), KEY_ACTION_NAMES)).toEqual([]);
    const ui = SOURCES.filter((f) => f.file.startsWith('src/ui/') && /\bkeyLegend\(/.test(f.text));
    expect(ui.map((f) => f.file)).not.toEqual([]);
  });

  it('fires on a key whose press changes nothing, and on a presentation field nobody reads', () => {
    expect(handlerProblem(() => pressKey('KeyZ'), SOURCES)).toBe('pressing it changes nothing');
    // The camera's view key before the integration round wired it (skeptic-hs: "C does nothing"):
    // with app/'s reader taken away, the check names the field.
    const unwired = SOURCES.map((f) => ({ ...f, text: f.text.replaceAll('.cycleCamera', '.view') }));
    expect(handlerProblem(() => pressKey('KeyC'), unwired)).toBe(
      'sets cycleCamera, which nothing outside input/ reads',
    );
    expect(handlerProblem(() => pressKey('KeyC'), SOURCES)).toBeNull();
  });

  it('fires on a key action left out of the legend', () => {
    const legend = keyLegend(DEFAULT_KEY_MAP).filter((r) => r.action !== KEY_ACTION_NAMES.kickStraight);
    expect(legendGaps(KEY_ACTIONS, legend, KEY_ACTION_NAMES)).toEqual(['kickStraight']);
  });
});

describe('reachability: every pad binding has a handler and a settings echo', () => {
  it('each bound button, and the stick, changes the action state, and the change is read', () => {
    const problems: string[] = [];
    let buttons = 0;
    for (const action of PAD_ACTIONS)
      for (const b of DEFAULT_PAD_MAP.buttons[action]) {
        buttons++;
        const p = handlerProblem(() => pressPad(b), SOURCES);
        if (p) problems.push(`${action} (button ${b}): ${p}`);
      }
    const stick = handlerProblem(() => {
      const a = emptyActions();
      const axes = [0, 0, 0, 0];
      axes[DEFAULT_PAD_MAP.steerAxis] = 1;
      new GamepadState().sample(a, [pad(null, axes)], 0.2);
      return a;
    }, SOURCES);
    if (stick) problems.push(`steer (axis ${DEFAULT_PAD_MAP.steerAxis}): ${stick}`);
    console.log(`[examined] ${buttons} pad buttons over ${PAD_ACTIONS.length} pad actions, and the stick`);
    expect(problems).toEqual([]);
  });

  it('each pad action is remappable from the settings record, and the remapped button works', () => {
    expect(unremappable(PAD_ACTIONS)).toEqual([]);
  });

  it('fires on a pad action the settings record cannot remap', () => {
    // An action id the settings sanitiser refuses (ids are letters and digits) never reaches input.
    expect(unremappable(['cycle-camera' as PadButtonAction])).toEqual([
      'cycle-camera: the saved remap is lost',
    ]);
  });
});
