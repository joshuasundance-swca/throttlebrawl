// Pivot FM's songs (run W-U, the pitch deck's #5: "When Pivot rides, Pivot FM appears and changes
// genre every eight bars"). A `pivot-medley` track is a medley: every eight bars it pivots to another
// of the radio's bands (sixteen since playtest 4), each part a real song of that band cut to its first eight bars (a
// shorter song repeats to fill them). No two parts in a row share a band, and each band plays at
// its own tempo, so every pivot is a hard cut. Pure and seeded like every composer: the same track
// always plays the same medley. It lives in the radio's lazy chunk (radio-band.ts).
import { composeTrack, type Composition, type MedleyPart, type RadioNote } from './radio-compose';
import type { RadioGenre } from './radio-synth';
import { seededRandom } from './radio-util';

export const PIVOT_PRESET = 'pivot-medley';

/** Every band a medley can pivot to: its composer preset and the rig that plays it. */
export const PIVOT_BANDS: readonly { preset: string; genre: RadioGenre }[] = [
  { preset: 'surf-trio', genre: 'surf' },
  { preset: 'rockabilly-trio', genre: 'rockabilly' },
  { preset: 'grunge-band', genre: 'grunge' },
  { preset: 'folk-band', genre: 'folk' },
  { preset: 'synth-band', genre: 'synth' },
  { preset: 'psych-band', genre: 'psych' },
  { preset: 'island-band', genre: 'island' },
  { preset: 'dub-band', genre: 'dub' },
  { preset: 'stoner-band', genre: 'stoner' },
  { preset: 'ambient-band', genre: 'ambient' },
  { preset: 'funk-band', genre: 'funk' },
  { preset: 'chip-band', genre: 'chip' },
  // Playtest 4 (P4-17).
  { preset: 'garage-band', genre: 'garage' },
  { preset: 'darkwave-band', genre: 'darkwave' },
  { preset: 'swamp-band', genre: 'swamp' },
  { preset: 'jazz-band', genre: 'jazz' },
];

/** Bars per part [default]: "changes genre every eight bars". */
export const PIVOT_BARS = 8;
/** Parts per medley [default], and the range a track's `parts` param may set. */
export const PIVOT_PARTS = { default: 6, min: 2, max: 12 } as const;

/** A song cut (or repeated) to exactly `bars` bars. */
export function cutToBars(c: Composition, bars: number): Composition {
  const steps = bars * c.stepsPerBar;
  const notes: RadioNote[] = [];
  for (let offset = 0; offset < steps && c.steps > 0; offset += c.steps) {
    for (const n of c.notes) {
      const step = n.step + offset;
      if (step < steps) notes.push(offset === 0 ? n : { ...n, step });
    }
  }
  return { ...c, bars, steps, notes };
}

/**
 * Composes a medley. `parts` (2 to 12, 6 by default) sets how many pivots a track makes; the bands
 * are drawn from the seed, never the same band twice in a row.
 */
export function composeMedley(params: Readonly<Record<string, unknown>>, seed: number): Composition | null {
  const r = seededRandom(seed >>> 0);
  const want = typeof params['parts'] === 'number' && Number.isFinite(params['parts']) ? params['parts'] : 0;
  const count = want
    ? Math.min(PIVOT_PARTS.max, Math.max(PIVOT_PARTS.min, Math.round(want)))
    : PIVOT_PARTS.default;
  const parts: MedleyPart[] = [];
  let last = -1;
  for (let i = 0; i < count; i++) {
    let b = Math.floor(r() * PIVOT_BANDS.length);
    if (b === last) b = (b + 1 + Math.floor(r() * (PIVOT_BANDS.length - 1))) % PIVOT_BANDS.length;
    last = b;
    const band = PIVOT_BANDS[b]!;
    const song = composeTrack({ preset: band.preset }, (seed + Math.imul(i + 1, 0x9e3779b1)) >>> 0);
    if (!song) continue;
    parts.push({ genre: band.genre, comp: cutToBars(song, PIVOT_BARS) });
  }
  const first = parts[0];
  if (!first) return null;
  return { ...first.comp, form: 'medley', seed: seed >>> 0, medley: parts };
}
