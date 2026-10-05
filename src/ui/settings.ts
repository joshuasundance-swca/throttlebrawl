// The settings screen as data (docs/milestones/M2.md, ui-2): one table row per setting, one change
// at a time, applied to a copy of the record. The screen draws the table; app/ applies each value
// (to SimConfig at the next race, to input, camera, the loop) and save/ stores the record (save-2
// owns its fields, names and defaults; the table reads its defaults from there).
//
// A setting shows only when its effect is live and the saved record keeps it: a setting whose
// non-default value changes nothing observable is a bug (M2's cross-lane rules), and one that
// forgets itself on reload is too. "Live" means app/ has wired it (`UiOptions.liveSettings`), or
// the effect is ui's own (the tuning entry) or was wired in M1 (units). "Kept" is checked against
// save/'s own sanitiser.
import { DEFAULT_SETTINGS, type Settings } from '../save';

export type VolumeBus = keyof Settings['volumes'];
export const VOLUME_BUSES: readonly { bus: VolumeBus; label: string }[] = [
  { bus: 'master', label: 'Master' },
  { bus: 'music', label: 'Music' },
  { bus: 'effects', label: 'Effects' },
  { bus: 'voices', label: 'Voices' },
];

/** A setting's path in the record: a field name, or `assists.steer` for the one nested field. */
export type SettingId =
  | 'units'
  | 'difficulty'
  | 'raceLength'
  | 'speedMultiplier'
  | 'assists.steer'
  | 'steerStyle'
  | 'slowMo'
  | 'steering'
  | 'tiltSensitivity'
  | 'throttle'
  | 'pullBackBrake'
  | 'haptics'
  | 'reduceShake'
  | 'reduceMotion'
  | 'textSize'
  | 'frameRateCap'
  | 'look'
  | 'stylePopups'
  | 'view'
  | 'radio'
  | 'voicesOn'
  | 'showTuningPanel';
export type SettingValue = string | number | boolean;
export type SettingsTab = 'sound' | 'race' | 'controls' | 'display' | 'access';

export interface SettingDef {
  id: SettingId;
  tab: SettingsTab;
  label: string;
  kind: 'choice' | 'toggle';
  /** Choices, in display order (choice settings only). */
  options?: readonly { value: SettingValue; label: string }[];
  /** Feeds SimConfig: applies at the next race start or restart, never mid-race. */
  nextRace?: boolean;
}

export const SETTINGS_TABS: readonly { tab: SettingsTab; label: string }[] = [
  { tab: 'sound', label: 'Sound' },
  { tab: 'race', label: 'Race' },
  { tab: 'controls', label: 'Controls' },
  { tab: 'display', label: 'Display' },
  // M5's a11y-1: the accessibility options together, with their own tab so the Display tab still fits
  // a phone held sideways.
  { tab: 'access', label: 'Access' },
];

/** Every M2 setting except the M1 volumes, mute and mirror, which the screen draws itself. */
export const SETTINGS: readonly SettingDef[] = [
  // Sound: the voices off switch (run W-O, maintainer 2026-10-01: "add a Voices volume and an off
  // switch"), under the four volume sliders; off silences the spoken barks and keeps the Voices
  // slider's level. Applies at once.
  { id: 'voicesOn', tab: 'sound', label: 'Voices on', kind: 'toggle' },
  // Sound: the radio (radio-1), below the volumes. Applies at once; the pause menu's radio panel
  // and the R key switch stations mid-race.
  {
    id: 'radio',
    tab: 'sound',
    label: 'Radio',
    kind: 'choice',
    options: [
      { value: 'score', label: 'Score' },
      { value: 'station', label: 'Station' },
      { value: 'off', label: 'Off' },
    ],
  },
  // Race: everything that feeds SimConfig.
  {
    id: 'difficulty',
    tab: 'race',
    label: 'Difficulty',
    kind: 'choice',
    options: [
      { value: 'easy', label: 'Easy' },
      { value: 'normal', label: 'Normal' },
      { value: 'hard', label: 'Hard' },
    ],
    nextRace: true,
  },
  {
    id: 'raceLength',
    tab: 'race',
    label: 'Race length',
    kind: 'choice',
    options: [
      { value: 'short', label: 'Short' },
      { value: 'standard', label: 'Standard' },
      { value: 'long', label: 'Long' },
    ],
    nextRace: true,
  },
  {
    // riders-4 offers 0.6 to 1.0 (SPEED_MULTIPLIER_MIN in sim/riders).
    id: 'speedMultiplier',
    tab: 'race',
    label: 'Game speed',
    kind: 'choice',
    options: [
      { value: 1, label: 'Full' },
      { value: 0.9, label: '90%' },
      { value: 0.8, label: '80%' },
      { value: 0.7, label: '70%' },
      { value: 0.6, label: '60%' },
    ],
    nextRace: true,
  },
  {
    // Playtest 4, P4-8 (the maintainer: "maybe allow true assist off but rename today's default.
    // arcade guided good."): today's guided riding model under its honest name, the default, and an
    // opt-in Free style where held lock keeps turning the bike. Above the assist, which is separate.
    id: 'steerStyle',
    tab: 'race',
    label: 'Steering style',
    kind: 'choice',
    options: [
      { value: 'arcade', label: 'Arcade' },
      { value: 'free', label: 'Free' },
    ],
    nextRace: true,
  },
  {
    id: 'assists.steer',
    tab: 'race',
    label: 'Steering assist',
    kind: 'choice',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'light', label: 'Light' },
      { value: 'strong', label: 'Strong' },
    ],
    nextRace: true,
  },
  { id: 'slowMo', tab: 'race', label: 'Takedown slow motion', kind: 'toggle', nextRace: true },
  // Controls.
  {
    id: 'steering',
    tab: 'controls',
    label: 'Steering',
    kind: 'choice',
    options: [
      { value: 'thumb', label: 'Thumb' },
      { value: 'tilt', label: 'Tilt' },
      { value: 'both', label: 'Both' },
    ],
  },
  {
    id: 'tiltSensitivity',
    tab: 'controls',
    label: 'Tilt sensitivity',
    kind: 'choice',
    options: [
      { value: 0.5, label: 'Low' },
      { value: 1, label: 'Normal' },
      { value: 1.5, label: 'High' },
      { value: 2, label: 'Max' },
    ],
  },
  {
    id: 'throttle',
    tab: 'controls',
    label: 'Throttle',
    kind: 'choice',
    options: [
      { value: 'scaled', label: 'Drag' },
      { value: 'auto', label: 'Auto' },
    ],
  },
  { id: 'pullBackBrake', tab: 'controls', label: 'Pull back to brake', kind: 'toggle' },
  { id: 'haptics', tab: 'controls', label: 'Vibration', kind: 'toggle' },
  // Display.
  {
    id: 'units',
    tab: 'display',
    label: 'Speed in',
    kind: 'choice',
    options: [
      { value: 'mph', label: 'mph' },
      { value: 'kmh', label: 'km/h' },
    ],
  },
  {
    // Divisors of the display's refresh: smooth first, half is the ~30 fps battery saver on a 60 Hz
    // screen (docs/product-spec.md, "Settings").
    id: 'frameRateCap',
    tab: 'display',
    label: 'Frame rate',
    kind: 'choice',
    options: [
      { value: 'full', label: 'Smooth' },
      { value: 'half', label: 'Half' },
      { value: 'third', label: 'Third' },
    ],
  },
  {
    // Playtest 1b item 6: styles as settings [decided]. Applies at once, even mid-race.
    id: 'look',
    tab: 'display',
    label: 'Look',
    kind: 'choice',
    options: [
      { value: 'classic', label: 'Classic' },
      { value: 'kodak', label: 'Ink + 60s film' },
      // Playtest 1c item 5.
      { value: 'wasteland', label: 'Sun-bleached wasteland' },
      { value: 'brush', label: 'Kodachrome brush' },
    ],
  },
  {
    // camera-3's base framings (camera.mode 0, 1, 2). Applies at once, even mid-race.
    id: 'view',
    tab: 'display',
    label: 'View',
    kind: 'choice',
    options: [
      { value: 'chase', label: 'Chase' },
      { value: 'far', label: 'Far' },
      { value: 'helmet', label: 'Helmet' },
    ],
  },
  // Playtest 1c: the style cash chips and the live meter, on by default. ui's own effect.
  { id: 'stylePopups', tab: 'display', label: 'Style pop-ups', kind: 'toggle' },
  { id: 'showTuningPanel', tab: 'display', label: 'Tuning panel in pause menu', kind: 'toggle' },
  // Access (M5's a11y-1; playtest 4 run B, B13): "accessibility without being obtrusive". Reduce screen
  // shake is the narrow switch the maintainer decided on. Reduce motion is the wider one: no shake, a
  // softer lean roll and speed FOV kick, no white hit flash, a slower cops' light bar, no HUD
  // animation. Text size grows the menus, the ticker and the HUD's text. All three apply at once,
  // even mid-race.
  { id: 'reduceShake', tab: 'access', label: 'Reduce screen shake', kind: 'toggle' },
  { id: 'reduceMotion', tab: 'access', label: 'Reduce motion', kind: 'toggle' },
  {
    id: 'textSize',
    tab: 'access',
    label: 'Text size',
    kind: 'choice',
    options: [
      { value: 'normal', label: 'Normal' },
      { value: 'large', label: 'Large' },
      { value: 'largest', label: 'Largest' },
    ],
  },
];

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export function settingDef(id: SettingId): SettingDef {
  const def = byId.get(id);
  if (!def) throw new Error(`ui: unknown setting ${id}`);
  return def;
}

/**
 * Settings live without app/ declaring them: units (wired in M1), and the tuning entry and the style
 * pop-ups and the text size (ui's own effects).
 */
export const ALWAYS_LIVE: readonly SettingId[] = ['units', 'showTuningPanel', 'stylePopups', 'textSize'];

/**
 * Settings ui applies itself through a presentation tuning slider that app/ routes to its module
 * (the view to camera/, the radio to audio/). Each is live once the registry declares its slider.
 */
export const TUNED_SETTINGS: Readonly<Partial<Record<SettingId, string>>> = {
  view: 'camera.mode',
  radio: 'audio.radio',
};

/** The tuned settings whose slider the registry declares. */
export function tunedLive(declared: (id: string) => boolean): SettingId[] {
  return (Object.entries(TUNED_SETTINGS) as [SettingId, string][])
    .filter(([, param]) => declared(param))
    .map(([id]) => id);
}

/** The raw value at a setting's path. */
function read(s: unknown, id: SettingId): unknown {
  let v: unknown = s;
  for (const key of id.split('.')) {
    v = typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined;
  }
  return v;
}

function valid(def: SettingDef, value: unknown): value is SettingValue {
  if (def.kind === 'toggle') return typeof value === 'boolean';
  return (def.options ?? []).some((o) => o.value === value);
}

/** The setting's default: save/'s. */
export function settingDefault(id: SettingId): SettingValue {
  return read(DEFAULT_SETTINGS, id) as SettingValue;
}

/** The setting's value in the record, or its default when the record's value is not on offer. */
export function settingValue(s: Readonly<Settings>, id: SettingId): SettingValue {
  const v = read(s, id);
  return valid(settingDef(id), v) ? v : settingDefault(id);
}

/** The first value that is not the default: a toggle flipped, or the first other choice. */
export function nonDefaultValue(def: SettingDef): SettingValue {
  const d = settingDefault(def.id);
  if (def.kind === 'toggle') return !d;
  const other = (def.options ?? []).find((o) => o.value !== d);
  if (!other) throw new Error(`ui: setting ${def.id} has no second choice`);
  return other.value;
}

export type SettingsChange =
  | { kind: 'volume'; bus: VolumeBus; value: number }
  | { kind: 'mute'; value: boolean }
  | { kind: 'mirror'; value: boolean }
  | { kind: 'set'; id: SettingId; value: unknown }
  | { kind: 'seen'; build: string };

const unit = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** A copy of `obj` with the value at `path` replaced, copying each object on the way down. */
function writePath(
  obj: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [key, ...rest] = path;
  if (key === undefined) return obj;
  const inner = obj[key];
  const child = typeof inner === 'object' && inner !== null ? (inner as Record<string, unknown>) : {};
  return { ...obj, [key]: rest.length ? writePath(child, rest, value) : value };
}

export function applySettingsChange(s: Readonly<Settings>, c: SettingsChange): Settings {
  const next: Settings = { ...s, volumes: { ...s.volumes } };
  if (c.kind === 'volume') next.volumes[c.bus] = unit(c.value);
  else if (c.kind === 'mute') next.mute = c.value;
  else if (c.kind === 'mirror') next.mirror = c.value;
  else if (c.kind === 'seen') next.lastSeenBuild = c.build;
  else if (valid(settingDef(c.id), c.value)) {
    return writePath(
      next as unknown as Record<string, unknown>,
      c.id.split('.'),
      c.value,
    ) as unknown as Settings;
  }
  return next;
}

/**
 * Whether the saved record keeps this setting: a non-default value survives the record's own
 * sanitiser (save/'s `sanitiseSettings`, passed in so tests can stand in for it).
 */
export function settingPersists(id: SettingId, sanitise: (data: unknown) => Settings): boolean {
  const value = nonDefaultValue(settingDef(id));
  const probe = writePath({}, id.split('.'), value);
  return read(sanitise(probe), id) === value;
}

/** Whether the record keeps the last-seen build (the what's-new card needs it, or it would nag). */
export function lastSeenPersists(sanitise: (data: unknown) => Settings): boolean {
  const probe = 'probe-build';
  return read(sanitise({ lastSeenBuild: probe }), 'lastSeenBuild' as SettingId) === probe;
}

export interface VisibleOptions {
  /** The settings app/ has wired. */
  live: readonly SettingId[];
  persists: (id: SettingId) => boolean;
  /** Preview mode (`?settings=all`): every setting, wired or not, for agents and layout tests. */
  preview: boolean;
}

/** The settings the screen shows, in table order. */
export function visibleSettings(o: VisibleOptions): SettingId[] {
  const live = new Set<SettingId>([...ALWAYS_LIVE, ...o.live]);
  return SETTINGS.filter((s) => o.preview || (live.has(s.id) && o.persists(s.id))).map((s) => s.id);
}
