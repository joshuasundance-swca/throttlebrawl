// tuning: the parameter registry and presets (docs/architecture.md, "Tuning"). Declarations live
// beside the systems they tune; app/ gathers them and hands the list here. tuning/ imports only
// core, so it reaches the replay and the sim only through the injected recordTuningChange.
export { createTuningRegistry, TUNING_OWN } from './registry';
export type { TuningListener, TuningRegistry, TuningRegistryOptions } from './registry';
export {
  createFrameGate,
  FRAME_CAP_TUNING,
  FRAME_DIVISOR_ID,
  frameCapOptions,
  measureRefreshHz,
  sanitizeDivisor,
} from './frame-cap';
export type { FrameCapOption, FrameGate } from './frame-cap';
export {
  checkPresetValues,
  createMemoryStorage,
  createPresetStore,
  exportPreset,
  presetIdFor,
  REGISTRY_PRESET_ID,
  resolvePreset,
  TUNING_PRESET_RECORD,
  TUNING_PRESET_RECORD_VERSION,
} from './presets';
export type { PresetLike, PresetStorage, PresetStore, PresetStoreOptions, TuningPresetFile } from './presets';
