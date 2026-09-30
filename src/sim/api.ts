// The public sim contract (docs/architecture.md, "Sim contract (src/sim/api.ts)"). Every module
// outside src/sim reaches the sim only through this file. A contract: changes land in a small
// contract PR (docs/milestones/M1.md, "Cross-lane rules").
//
// It also re-exports the core and road types that presentation modules need but may not import
// themselves under the module map (app, ui, render, camera, audio, replay and dev reach core only
// through here), so a callback "typed in core" has one definition.
import { clamp } from '../core';
import { InputFlag, type SimInput } from './types';

export { createSim, SIM_TUNING } from './create';
export { InputFlag, SIM_DT, SIM_HZ } from './types';
export type {
  AttackPhase,
  EntityKind,
  EntitySnapshot,
  Faction,
  MoverMode,
  ParkedBikeSnapshot,
  RaceSnapshot,
  RoadPosSnapshot,
  Sim,
  SimAiPersonality,
  SimBikeDef,
  SimConfig,
  SimController,
  SimDifficulty,
  SimEvent,
  SimEventDef,
  SimEventType,
  SimInput,
  SimLawDef,
  SimRiderDef,
  SimSnapshot,
  SimTrafficTypeDef,
  SimWeaponDef,
  SlowmoSnapshot,
} from './types';

// Shared core types and helpers, for modules the module map keeps away from core.
export type {
  AssetIndexEntry,
  GetReplayAndSettings,
  LaneInfo,
  LayoutElement,
  OnCopyReport,
  PackIndexFn,
  RecordTuningChange,
  RendererStats,
  RendererStatsFn,
  ReplayAndSettings,
  ResumeAudio,
  RoadQueriesFn,
  RouteQueries,
  TouchLayout,
  TuningParamDecl,
  TuningValues,
} from '../core';
export { hashHex, placeElement, secondsToTicks, tuningDefaults } from '../core';
export type { RoadFrame, RoadNetwork, RouteProgress, WorldPoint } from '../road';

/** Analog controls (steer −1..1, throttle and brake 0..1) plus flag bits, quantized for the sim. */
export interface AnalogInput {
  steer: number;
  throttle: number;
  brake: number;
  flags: number;
}

/**
 * Rounds to a canonical integer: never -0 (Math.round(-0.3) is -0, which JSON writes as 0, so a
 * recording replayed from a file would hash differently) and never NaN.
 */
const level = (x: number, scale: number) => Math.round(x * scale) || 0;

export function quantizeInput(a: AnalogInput): SimInput {
  return {
    steer: level(clamp(a.steer, -1, 1), 127),
    throttle: level(clamp(a.throttle, 0, 1), 255),
    brake: level(clamp(a.brake, 0, 1), 255),
    flags: a.flags & 0xff,
  };
}

export function neutralInput(): SimInput {
  return { steer: 0, throttle: 0, brake: 0, flags: 0 };
}

/** Whether a flag bit is set, by name. */
export function hasFlag(input: SimInput, flag: keyof typeof InputFlag): boolean {
  return (input.flags & InputFlag[flag]) !== 0;
}
