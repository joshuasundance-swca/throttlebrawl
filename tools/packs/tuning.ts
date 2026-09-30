// Every tuning declaration the build knows, for the tuning-key lint. This mirrors the list app/
// hands to tuning/ (src/app/index.ts: SIM_TUNING + CAMERA_TUNING + AUDIO_TUNING). A module that
// starts declaring parameters adds its list here too, or a preset using its keys fails the lint
// with "unknown tuning key", which says where to look.
import { AUDIO_TUNING } from '../../src/audio';
import { CAMERA_TUNING } from '../../src/camera';
import { SIM_TUNING, type TuningParamDecl } from '../../src/sim/api';

export const ALL_TUNING: readonly TuningParamDecl[] = [...SIM_TUNING, ...CAMERA_TUNING, ...AUDIO_TUNING];
