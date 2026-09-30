// The settings screen as data (docs/milestones/M2.md, ui-2): one table row per setting, one change
// at a time, applied to a copy of the record. The screen draws the table; app/ applies each value
// (to SimConfig at the next race, to input, camera, the loop) and save/ stores the record.
//
// A setting shows only when its effect is live and the saved record keeps it: a setting whose
// non-default value changes nothing observable is a bug (M2's cross-lane rules), and one that
// forgets itself on reload is too. "Live" means app/ has wired it (`UiOptions.liveSettings`), or
// the effect is ui's own (the tuning entry) or was wired in M1 (units). "Kept" is checked against
// save/'s own sanitiser, so each setting appears by itself once save-2 adds its field.
import type { Settings } from '../save';

export type VolumeBus = keyof Settings['volumes'];
export const VOLUME_BUSES: readonly { bus: VolumeBus; label: string }[] = [
  { bus: 'master', label: 'Master' },
  { bus: 'music', label: 'Music' },
  { bus: 'effects', label: 'Effects' },
  { bus: 'voices', label: 'Voices' },
];

/**
 * The M2 fields of the settings record, by the names the settings screen writes (save-2 owns the
 * record and its defaults; these names are the ones ui reads and writes). [default]
 */
export interface M2Settings {
  difficulty: 'easy' | 'normal' | 'hard';
  raceLength: 'short' | 'standard' | 'long';
  /** The lower-overall-speed multiplier, in (0, 1]. */
  speedMultiplier: number;
  steerAssist: 'off' | 'light' | 'strong';
  /** The takedown slow motion. */
  slowMo: boolean;
  steering: 'thumb' | 'tilt' | 'both';
  throttle: 'scaled' | 'auto';
  pullBackBrake: boolean;
  haptics: boolean;
  /** The reduce-screen-shake setting: 1 full shake and hit jolt, 0 none (camera's setShakeAmount). */
  screenShake: number;
  /** Smooth (the display's full rate) or the battery saver (about 30 fps). */
  frameCap: 'full' | 'saver';
  /** "Show tuning panel in the pause menu". */
  showTuning: boolean;
  /** The last build whose what's-new card this device showed (ui-3). */
  lastSeenBuild: string;
}

/** The record as ui sees it: save/'s fields, plus the M2 fields once save/ keeps them. */
export type UiSettings = Settings & Partial<M2Settings>;

export type SettingId = 'units' | Exclude<keyof M2Settings, 'lastSeenBuild'>;
export type SettingValue = string | number | boolean;
export type SettingsTab = 'sound' | 'race' | 'controls' | 'display';

export interface SettingDef {
  id: SettingId;
  tab: SettingsTab;
  label: string;
  kind: 'choice' | 'toggle';
  /** Choices, in display order (choice settings only). */
  options?: readonly { value: SettingValue; label: string }[];
  default: SettingValue;
  /** Feeds SimConfig: applies at the next race start or restart, never mid-race. */
  nextRace?: boolean;
}

export const SETTINGS_TABS: readonly { tab: SettingsTab; label: string }[] = [
  { tab: 'sound', label: 'Sound' },
  { tab: 'race', label: 'Race' },
  { tab: 'controls', label: 'Controls' },
  { tab: 'display', label: 'Display' },
];

/** Every M2 setting except the M1 volumes, mute and mirror, which the screen draws itself. */
export const SETTINGS: readonly SettingDef[] = [
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
    default: 'normal',
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
    default: 'standard',
    nextRace: true,
  },
  {
    id: 'speedMultiplier',
    tab: 'race',
    label: 'Game speed',
    kind: 'choice',
    options: [
      { value: 1, label: 'Full' },
      { value: 0.9, label: '90%' },
      { value: 0.8, label: '80%' },
      { value: 0.7, label: '70%' },
    ],
    default: 1,
    nextRace: true,
  },
  {
    id: 'steerAssist',
    tab: 'race',
    label: 'Steering assist',
    kind: 'choice',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'light', label: 'Light' },
      { value: 'strong', label: 'Strong' },
    ],
    default: 'off',
    nextRace: true,
  },
  { id: 'slowMo', tab: 'race', label: 'Takedown slow motion', kind: 'toggle', default: true, nextRace: true },
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
    default: 'thumb',
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
    default: 'scaled',
  },
  { id: 'pullBackBrake', tab: 'controls', label: 'Pull back to brake', kind: 'toggle', default: false },
  { id: 'haptics', tab: 'controls', label: 'Vibration', kind: 'toggle', default: true },
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
    default: 'mph',
  },
  {
    id: 'screenShake',
    tab: 'display',
    label: 'Screen shake',
    kind: 'choice',
    options: [
      { value: 1, label: 'Full' },
      { value: 0.5, label: 'Less' },
      { value: 0, label: 'Off' },
    ],
    default: 1,
  },
  {
    id: 'frameCap',
    tab: 'display',
    label: 'Frame rate',
    kind: 'choice',
    options: [
      { value: 'full', label: 'Smooth' },
      { value: 'saver', label: 'Battery saver' },
    ],
    default: 'full',
  },
  { id: 'showTuning', tab: 'display', label: 'Tuning panel in pause menu', kind: 'toggle', default: false },
];

const byId = new Map(SETTINGS.map((s) => [s.id, s]));

export function settingDef(id: SettingId): SettingDef {
  const def = byId.get(id);
  if (!def) throw new Error(`ui: unknown setting ${id}`);
  return def;
}

/** Settings live without app/ declaring them: units (wired in M1) and the tuning entry (ui's own). */
export const ALWAYS_LIVE: readonly SettingId[] = ['units', 'showTuning'];

/** The setting's value in the record, or its default when the record lacks it. */
export function settingValue(s: Readonly<UiSettings>, id: SettingId): SettingValue {
  const v = (s as Readonly<Record<string, unknown>>)[id];
  const def = settingDef(id);
  return typeof v === typeof def.default ? (v as SettingValue) : def.default;
}

function valid(def: SettingDef, value: unknown): value is SettingValue {
  if (def.kind === 'toggle') return typeof value === 'boolean';
  return (def.options ?? []).some((o) => o.value === value);
}

/** The first value that is not the default: a toggle flipped, or the first other choice. */
export function nonDefaultValue(def: SettingDef): SettingValue {
  if (def.kind === 'toggle') return !def.default;
  const other = (def.options ?? []).find((o) => o.value !== def.default);
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

export function applySettingsChange(s: Readonly<UiSettings>, c: SettingsChange): UiSettings {
  const next: UiSettings = { ...s, volumes: { ...s.volumes } };
  if (c.kind === 'volume') next.volumes[c.bus] = unit(c.value);
  else if (c.kind === 'mute') next.mute = c.value;
  else if (c.kind === 'mirror') next.mirror = c.value;
  else if (c.kind === 'seen') next.lastSeenBuild = c.build;
  else if (valid(settingDef(c.id), c.value)) (next as unknown as Record<string, unknown>)[c.id] = c.value;
  return next;
}

/**
 * Whether the saved record keeps this setting: a non-default value survives the record's own
 * sanitiser (save/'s `sanitiseSettings`, passed in so tests can stand in for it).
 */
export function settingPersists(id: SettingId, sanitise: (data: unknown) => Settings): boolean {
  const value = nonDefaultValue(settingDef(id));
  const kept = (sanitise({ [id]: value }) as unknown as Readonly<Record<string, unknown>>)[id];
  return kept === value;
}

/** Whether the record keeps the last-seen build (the what's-new card needs it, or it would nag). */
export function lastSeenPersists(sanitise: (data: unknown) => Settings): boolean {
  const probe = 'probe-build';
  return (
    (sanitise({ lastSeenBuild: probe }) as unknown as Readonly<Record<string, unknown>>)['lastSeenBuild'] ===
    probe
  );
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
