// The radio's genre lists (which rig file plays which band), apart from the rigs themselves: radio.ts
// picks a station's band from them in the first load, and the rigs (radio-band.ts) load lazily.
import type { RadioGenre } from './radio-synth';

export type RegionalGenre = Extract<RadioGenre, 'grunge' | 'folk' | 'synth' | 'psych'>;
/** The regional bands' genres (radio-rigs.ts plays them). */
export const REGIONAL_GENRES: readonly RegionalGenre[] = ['grunge', 'folk', 'synth', 'psych'];

export type MoreGenre = Extract<RadioGenre, 'island' | 'dub' | 'stoner' | 'ambient' | 'funk' | 'chip'>;
/** The six newer bands' genres (radio-rigs-more.ts plays them). */
export const MORE_GENRES: readonly MoreGenre[] = ['island', 'dub', 'stoner', 'ambient', 'funk', 'chip'];

export type ExtraGenre = Extract<RadioGenre, 'garage' | 'darkwave' | 'swamp' | 'jazz'>;
/** Playtest 4's four bands (radio-rigs-extra.ts plays them). */
export const EXTRA_GENRES: readonly ExtraGenre[] = ['garage', 'darkwave', 'swamp', 'jazz'];

export const isRegional = (g: string): g is RegionalGenre =>
  (REGIONAL_GENRES as readonly string[]).includes(g);
export const isMore = (g: string): g is MoreGenre => (MORE_GENRES as readonly string[]).includes(g);
export const isExtra = (g: string): g is ExtraGenre => (EXTRA_GENRES as readonly string[]).includes(g);
