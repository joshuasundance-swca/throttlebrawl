// The difficulty presets (docs/milestones/M2.md, riders-5 and app-3 item 3). Easy, Normal and Hard
// set rival aggression, cop frequency and rubber-banding [decided]; the scales are tuning
// declarations `difficulty.<preset>.<scale>`, so the panel can adjust them and a preset file can
// carry them, with no new entry type. app/'s buildSimConfig resolves the chosen preset into
// SimConfig.difficulty at race start; the sim only reads the result. They are aggregated into the
// sim's tuning list (like every other value the sim's outcome depends on), but `affectsSim` is
// false: a change applies at the next race start, never mid-race, so it cannot break a replay.
import type { TuningParamDecl } from './tuning';

export const DIFFICULTY_PRESETS = ['easy', 'normal', 'hard'] as const;
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number];
export const DEFAULT_DIFFICULTY: DifficultyPreset = 'normal';

export const DIFFICULTY_SCALES = ['riderAggression', 'copFrequency', 'rubberBand'] as const;
export type DifficultyScale = (typeof DIFFICULTY_SCALES)[number];

/** M2's starting numbers (docs/milestones/M2.md, "Starting numbers"); 1.0 is Normal. */
const STARTING: Readonly<Record<DifficultyPreset, Readonly<Record<DifficultyScale, number>>>> = {
  easy: { riderAggression: 0.75, copFrequency: 0.5, rubberBand: 1.5 },
  normal: { riderAggression: 1, copFrequency: 1, rubberBand: 1 },
  hard: { riderAggression: 1.25, copFrequency: 1.5, rubberBand: 0.5 },
};

const PRESET_LABEL: Readonly<Record<DifficultyPreset, string>> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
};
const SCALE_LABEL: Readonly<Record<DifficultyScale, string>> = {
  riderAggression: 'rival aggression',
  copFrequency: 'cop frequency',
  rubberBand: 'rubber-band strength',
};

export function difficultyTuningId(preset: DifficultyPreset, scale: DifficultyScale): string {
  return `difficulty.${preset}.${scale}`;
}

export const DIFFICULTY_TUNING: readonly TuningParamDecl[] = DIFFICULTY_PRESETS.flatMap((preset) =>
  DIFFICULTY_SCALES.map((scale) => ({
    id: difficultyTuningId(preset, scale),
    group: 'difficulty',
    label: `${PRESET_LABEL[preset]}: ${SCALE_LABEL[scale]}`,
    default: STARTING[preset][scale],
    min: 0,
    max: 3,
    step: 0.05,
    unit: '',
    affectsSim: false,
  })),
);

export function isDifficultyPreset(value: unknown): value is DifficultyPreset {
  return typeof value === 'string' && (DIFFICULTY_PRESETS as readonly string[]).includes(value);
}
