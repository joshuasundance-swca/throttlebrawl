// The collection of every module's tuning declarations (docs/milestones/M1.md, "Cross-lane rules":
// declarations live beside their systems; app/ gathers them and hands the list to tuning/). The
// sim's own come aggregated through sim/api, so app/ never imports a sim sub-folder. tuning/ adds
// its own (the frame-rate cap) inside the registry. tools/packs/tuning.ts keeps the same list for
// the preset lint; app/tuning.test.ts checks the two agree.
import { AUDIO_TUNING } from '../audio';
import { CAMERA_TUNING } from '../camera';
import { INPUT_TUNING } from '../input';
import { SIM_TUNING, type TuningParamDecl } from '../sim/api';
import { BARK_TUNING } from '../ui';

export const APP_TUNING: readonly TuningParamDecl[] = [
  ...SIM_TUNING,
  ...CAMERA_TUNING,
  ...AUDIO_TUNING,
  ...INPUT_TUNING,
  ...BARK_TUNING,
];

/** The presentation modules that take a tuning value at once through their own `setParam`. */
export type PresentationOwner = 'camera' | 'audio' | 'input' | 'barks';

/**
 * Which module a presentation-only value goes to, by id prefix, or null. Sim values never come here
 * (they reach the sim through SimConfig and `sim.applyParam`), and `display.*` is read by the
 * frame gate directly.
 */
export function presentationOwner(id: string): PresentationOwner | null {
  const prefix = id.slice(0, id.indexOf('.'));
  return prefix === 'camera' || prefix === 'audio' || prefix === 'input' || prefix === 'barks'
    ? prefix
    : null;
}
