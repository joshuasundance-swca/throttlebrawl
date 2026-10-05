// The radio's band (main-green-4, 2026-10-02): the code-made songs (radio-compose*.ts) and the
// instruments that play them (radio-synth.ts, radio-rigs*.ts), in one lazy chunk. They are the
// biggest piece of audio/ and nothing before the first station tunes in needs them, so the first
// load leaves them out: system.ts imports this file when the audio graph is built (the start tap),
// and radio.ts's player stays silent until it arrives. Tests and offline harnesses hand RADIO_BAND
// in directly.
import { isMore, isRegional } from './radio-genres';
import { composeTrack, type Composition } from './radio-compose';
import { composeMedley, PIVOT_PRESET } from './radio-compose-pivot';
import { createRegionalRig } from './radio-rigs';
import { createMoreRig } from './radio-rigs-more';
import { createRadioRig, type RadioGenre, type RadioRig } from './radio-synth';
import { trackSeed } from './radio-util';
import type { RadioBand, RadioTrack } from './radio';

/** The composition a track plays (null when the preset is unknown). */
export function composeFor(track: RadioTrack): Composition | null {
  if (!track.procedural) return null;
  const salt = track.procedural.params?.['seed'];
  const seed = trackSeed(track.ref, typeof salt === 'number' ? salt : 0);
  // Pivot FM's medleys (run W-U) are built from the other composers' songs.
  if (track.procedural.preset === PIVOT_PRESET) return composeMedley(track.procedural.params ?? {}, seed);
  return composeTrack(track.procedural, seed);
}

/** The rig that plays a genre's band. */
export function createBandRig(ctx: BaseAudioContext, out: AudioNode, genre: RadioGenre): RadioRig {
  if (isRegional(genre)) return createRegionalRig(ctx, out, genre);
  if (isMore(genre)) return createMoreRig(ctx, out, genre);
  return createRadioRig(ctx, out, genre);
}

export const RADIO_BAND: RadioBand = { compose: composeFor, rig: createBandRig };
