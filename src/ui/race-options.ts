// The menu race's options screen as data (playtest 4, P4-12 and P4-13: "Maybe Races from main menu
// should have options?"; "To change bike for main menu races you have to go into career garage").
// One row per option, each a list of choices the screen steps through with two arrows, sized for a
// thumb. A step is a new settings record: app/ saves it, so the picks are remembered between races,
// and the next menu race reads them (app/race-options.ts turns them into the race's config). The
// choices that depend on the region, the road and the garage come from app/ as a RaceOptionsView;
// the rest are fixed here. The screen's DOM is a lazy chunk (race-options-view.ts).
import {
  DEFAULT_RACE_OPTIONS,
  RACE_KINDS,
  sanitiseRaceOptions,
  type RaceKind,
  type RaceOptions,
  type RaceTraffic,
  type RaceWeather,
  type Settings,
} from '../save';
import type { DifficultyPreset } from '../sim/api';

/** One choice on a row: what it sets, its words, and an optional second line (a bike's top speed). */
export interface OptionChoice<T> {
  value: T;
  label: string;
  note?: string;
}

/** The choices app/ offers for the next menu race (they depend on the region, the road and the garage). */
export interface RaceOptionsView {
  /** Where the race runs, in words ("The Keys, Overseas Highway"): the menu's pickers choose it. */
  where: string;
  /** The garage's bike first (null), then every bike on offer. */
  bikes: readonly OptionChoice<string | null>[];
  /** "Any" first (null: drawn by the seed), then the region's times of day. */
  times: readonly OptionChoice<string | null>[];
  /** The usual count first (null), then the counts the region's cast can field. */
  rivals: readonly OptionChoice<number | null>[];
  /** The event's lengths; empty while a picked road sets the length. */
  lengths: readonly OptionChoice<string>[];
}

export type RaceOptionId =
  'kind' | 'bike' | 'time' | 'weather' | 'rivals' | 'cops' | 'difficulty' | 'length' | 'traffic';

export interface RaceOptionRow {
  id: RaceOptionId;
  label: string;
  choices: readonly OptionChoice<unknown>[];
  /** The choice the record holds now (the first when it holds one this row does not offer). */
  index: number;
}

/** The race types' words (P4-12's new types are [open]: one today, so its row stays hidden). */
const KIND_LABELS: Readonly<Record<RaceKind, string>> = { race: 'Race' };
const WEATHER: readonly OptionChoice<RaceWeather>[] = [
  { value: 'local', label: 'Local', note: 'as the region has it' },
  { value: 'dry', label: 'Dry' },
  { value: 'rain', label: 'Rain' },
];
const COPS: readonly OptionChoice<boolean>[] = [
  { value: true, label: 'On' },
  { value: false, label: 'Off' },
];
const DIFFICULTY: readonly OptionChoice<DifficultyPreset>[] = [
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];
const TRAFFIC: readonly OptionChoice<RaceTraffic>[] = [
  { value: 'none', label: 'None', note: 'an empty road' },
  { value: 'light', label: 'Light' },
  { value: 'usual', label: 'Usual' },
  { value: 'heavy', label: 'Heavy' },
];
/** The length an event races when the record names one it lacks (app/config.ts `eventLength`). */
const STANDARD_LENGTH = 'standard';

const indexOf = <T>(choices: readonly OptionChoice<T>[], value: T) =>
  Math.max(
    0,
    choices.findIndex((c) => c.value === value),
  );

/** Where each row reads its value in the record, and how a new one is written back. */
interface RowDef {
  id: RaceOptionId;
  label: string;
  choices(view: RaceOptionsView): readonly OptionChoice<unknown>[];
  read(s: Readonly<Settings>, choices: readonly OptionChoice<unknown>[]): number;
  write(s: Readonly<Settings>, value: unknown): Settings;
}

const withOption = <K extends keyof RaceOptions>(
  s: Readonly<Settings>,
  key: K,
  value: unknown,
): Settings => ({
  ...s,
  raceOptions: sanitiseRaceOptions({ ...s.raceOptions, [key]: value }),
});

const option = <K extends keyof RaceOptions>(
  id: RaceOptionId,
  label: string,
  key: K,
  choices: (view: RaceOptionsView) => readonly OptionChoice<unknown>[],
): RowDef => ({
  id,
  label,
  choices,
  read: (s, c) => indexOf(c, (s.raceOptions ?? DEFAULT_RACE_OPTIONS)[key]),
  write: (s, v) => withOption(s, key, v),
});

/** The rows in screen order. [default] */
const ROWS: readonly RowDef[] = [
  option('kind', 'Type', 'kind', () => RACE_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))),
  option('bike', 'Bike', 'bike', (v) => v.bikes),
  option('time', 'Time', 'timeOfDay', (v) => v.times),
  option('weather', 'Weather', 'weather', () => WEATHER),
  option('rivals', 'Rivals', 'rivals', (v) => v.rivals),
  option('cops', 'Cops', 'cops', () => COPS),
  {
    id: 'difficulty',
    label: 'Difficulty',
    choices: () => DIFFICULTY,
    read: (s, c) => indexOf(c, s.difficulty),
    write: (s, v) => ({ ...s, difficulty: v as DifficultyPreset }),
  },
  {
    id: 'length',
    label: 'Length',
    choices: (v) => v.lengths,
    read: (s, c) => {
      const at = c.findIndex((x) => x.value === s.raceLength);
      return at >= 0 ? at : indexOf(c, STANDARD_LENGTH);
    },
    write: (s, v) => ({ ...s, raceLength: String(v) }),
  },
  option('traffic', 'Traffic', 'traffic', () => TRAFFIC),
];

/** The rows to show for this view and record: only those with a choice to make. */
export function raceOptionRows(view: RaceOptionsView, s: Readonly<Settings>): RaceOptionRow[] {
  return ROWS.flatMap((def) => {
    const choices = def.choices(view);
    return choices.length > 1 ? [{ id: def.id, label: def.label, choices, index: def.read(s, choices) }] : [];
  });
}

/** The record after one step of a row (`dir` 1 forward, -1 back), wrapping at either end. */
export function stepRaceOption(
  view: RaceOptionsView,
  s: Readonly<Settings>,
  id: RaceOptionId,
  dir: 1 | -1,
): Settings {
  const def = ROWS.find((r) => r.id === id);
  const choices = def?.choices(view) ?? [];
  if (!def || choices.length === 0) return s;
  const n = choices.length;
  const next = choices[(((def.read(s, choices) + dir) % n) + n) % n];
  return next ? def.write(s, next.value) : s;
}
