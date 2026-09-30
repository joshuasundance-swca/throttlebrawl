// Every tuning declaration the build knows, for the tuning-key lint: the sim's aggregated list
// plus each presentation module's own. Imported from the declaring files directly (not through
// module index files), so this Node tool never loads browser-only code. A module that starts
// declaring parameters adds its list here, or a preset using its keys fails the lint with
// "unknown tuning key", which says where to look. app/ hands tuning/ its own combined list.
import { AUDIO_TUNING } from '../../src/audio';
import { CAMERA_TUNING } from '../../src/camera';
import { INPUT_TUNING } from '../../src/input/tuning';
import { SIM_TUNING, type TuningParamDecl } from '../../src/sim/api';
import { FRAME_CAP_TUNING } from '../../src/tuning/frame-cap';
import { BARK_TUNING } from '../../src/ui/narrative/selector';

export const ALL_TUNING: readonly TuningParamDecl[] = [
  ...SIM_TUNING,
  ...CAMERA_TUNING,
  ...AUDIO_TUNING,
  ...INPUT_TUNING,
  ...BARK_TUNING,
  // tuning/'s own declarations (the registry always includes them).
  ...FRAME_CAP_TUNING,
];
