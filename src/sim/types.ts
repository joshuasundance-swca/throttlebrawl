// The sim contract's types (docs/architecture.md, "Sim contract"). Re-exported by src/sim/api.ts,
// which is the only file outside src/sim may import. Field lists are the architecture doc's
// minimum plus what the M1 lanes need; the contract owner may add fields in a contract PR.
import type { EntityId, TuningValues } from '../core';
import type { RoadNetwork, RouteProgress } from '../road';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// ---- Input -------------------------------------------------------------------------------

/** Flag bits of SimInput.flags. `grab` is reserved; `lookBack` and `pause` are ignored by the sim. */
export const InputFlag = {
  attack: 1,
  attackSideLeft: 2,
  attackSideRight: 4,
  kick: 8,
  grab: 16,
  lookBack: 32,
  skipRunBack: 64,
  pause: 128,
} as const;

/** One player slot's command for one tick, quantized so recordings are exact. */
export interface SimInput {
  /** int8, -127 (full left) .. 127 (full right). */
  steer: number;
  /** uint8, 0..255. */
  throttle: number;
  /** uint8, 0..255. */
  brake: number;
  /** InputFlag bits. */
  flags: number;
}

// ---- Snapshot ----------------------------------------------------------------------------

export type MoverMode = 'Road' | 'Airborne' | 'Tumble' | 'OnFoot' | 'Free';
export type EntityKind = 'rider' | 'vehicle' | 'ped' | 'pickup';
export type Faction = 'rider' | 'law';
export type AttackPhase = 'idle' | 'windup' | 'active' | 'recovery' | 'cooldown';

export interface RoadPosSnapshot {
  edge: number;
  s: number;
  d: number;
  /** Metres above the road surface (0 when grounded). */
  h: number;
  dir: 1 | -1;
  /** Heading offset from the road tangent, radians, positive toward the rider's right. */
  yaw: number;
}

export interface EntitySnapshot {
  id: EntityId;
  kind: EntityKind;
  mode: MoverMode;
  road: RoadPosSnapshot;
  /** World position (x east, y up, z south), for render. */
  x: number;
  y: number;
  z: number;
  /** World heading about +y, radians; a model facing -z turns by exactly this (three.js rotation.y). */
  heading: number;
  speed: number;
  lean: number;
  // Rider fields (neutral values for other kinds).
  contentId: string;
  name: string;
  faction: Faction;
  /** Player slot, or -1 for an AI-driven rider. */
  slot: number;
  throttle: number;
  rpm: number;
  gear: number;
  grounded: boolean;
  health: number;
  healthMax: number;
  attackPhase: AttackPhase;
  heldWeapon: string | null;
  /** Current auto-target, or -1. */
  targetId: EntityId;
  lastAttackerId: EntityId;
  /** Metres from the start line along the route. */
  progress: number;
  distanceToFinish: number;
  /** Live race position, 1 = leading. */
  place: number;
  finished: boolean;
}

export interface RaceSnapshot {
  over: boolean;
  routeLength: number;
  /** Entity ids in finishing order. */
  finishOrder: readonly EntityId[];
}

export interface SimSnapshot {
  tick: number;
  timeScale: number;
  entities: readonly EntitySnapshot[];
  race: RaceSnapshot;
}

// ---- Events ------------------------------------------------------------------------------

export type SimEventType =
  | 'raceStart'
  | 'raceEnd'
  | 'finish'
  | 'overtake'
  | 'lapOrCheckpoint'
  | 'attackStart'
  | 'attackMiss'
  | 'hit'
  | 'kick'
  | 'weaponGrab'
  /** A rider lost stability without going down (barrier scrape, rough landing, a first contact). */
  | 'wobble'
  | 'crash'
  | 'takedown'
  | 'nearMiss'
  | 'bust'
  /** The cop's siren cue for audio: `data.on` is true when a chase starts, false when it ends. */
  | 'siren'
  | 'jump'
  | 'land'
  | 'pedDive'
  | 'cashAward'
  | 'style'
  | 'modifierStart'
  | 'modifierEnd';

export interface SimEvent {
  tick: number;
  type: SimEventType;
  actor: EntityId;
  target?: EntityId;
  /** Links cause chains: a kick causes a crash, which causes a car to brake. */
  causeId?: number;
  data: Readonly<Record<string, number | string | boolean>>;
}

// ---- Config ------------------------------------------------------------------------------

export interface SimBikeDef {
  contentId: string;
  topSpeedMps: number;
  accelMps2: number;
  brakeMps2: number;
  /** Maximum lateral speed across the road, m/s. */
  steerRateMps: number;
  massKg: number;
}

/**
 * Who drives a rider. `cop` is an in-sim AIController like `ai`, but sim/cops runs it in the cops
 * phase, so its command takes effect on the next tick; the controllers phase leaves it alone.
 */
export type SimController =
  { kind: 'player'; slot: number } | { kind: 'ai'; style: string } | { kind: 'cop' };

/** A cop's `law` block (docs/content-packs.md, "Rider"), as the sim reads it. */
export interface SimLawDef {
  /** Content id of the agency (a `law` crew). */
  agency: string;
  bustRadiusM: number;
  bustDwellS: number;
  fineCash: number;
  /** Informational: the resolver has already scaled the cop's `bike.topSpeedMps` by it. */
  pursuitSpeedScale: number;
}

export interface SimRiderDef {
  contentId: string;
  name: string;
  role: 'player' | 'rival' | 'cop' | 'extra';
  faction: Faction;
  controller: SimController;
  bike: SimBikeDef;
  massKg: number;
  healthMax: number;
  /** Present on a cop (role `cop`, faction `law`). */
  law?: SimLawDef | undefined;
}

/** A weapon with its timings already converted to ticks (docs/content-packs.md, "Units and axes"). */
export interface SimWeaponDef {
  contentId: string;
  unarmed: boolean;
  reachSM: number;
  reachDM: number;
  windupTicks: number;
  activeTicks: number;
  recoveryTicks: number;
  cooldownTicks: number;
  damage: number;
  hitStopMs: number;
  /** Sideways speed a landed hit gives the target, m/s (the weapon's `knockback.lateralMps`; 0 if absent). */
  knockbackMps: number;
  /** How long a landed hit staggers the target, in ticks (`knockback.staggerS`; 0 if absent). */
  staggerTicks: number;
  steal: { startTick: number; endTick: number } | null;
}

export interface SimTrafficTypeDef {
  contentId: string;
  category: 'car' | 'truck' | 'rv' | 'oddity' | 'pedestrian' | 'animal';
  lengthM: number;
  widthM: number;
  cruiseMps: number;
  hazard: 'normal' | 'big';
}

export interface SimEventDef {
  contentId: string;
  kind: 'classic-race' | 'takedown-hunt' | 'cop-escape' | 'grudge-match';
  /** Rival race pace, m/s. */
  paceMps: number;
  /** Prize per place, index 0 = first. */
  byPlaceCash: readonly number[];
  /** Race-end timeout after the player finishes, in ticks. */
  raceEndTimeoutTicks: number;
}

/** Resolved difficulty scales, 1.0 = Normal. The preset id travels for display only. */
export interface SimDifficulty {
  presetId: string;
  riderAggression: number;
  copFrequency: number;
  rubberBand: number;
}

export interface SimConfig {
  seed: number;
  event: SimEventDef;
  /** Riders in grid order: index i starts in grid slot i. */
  riders: readonly SimRiderDef[];
  weapons: readonly SimWeaponDef[];
  trafficTypes: readonly SimTrafficTypeDef[];
  /** The road network handle (built from baked data by stream/, the same object render uses). */
  road: RoadNetwork;
  route: RouteProgress;
  /** Resolved event modifiers: always empty before M4. */
  modifiers: readonly never[];
  /** Grudge points per rival toward each rider, by content id: empty before M4. */
  grudges: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Sim-affecting tuning values at race start, by declaration id. */
  tuning: TuningValues;
  difficulty: SimDifficulty;
  assists: 'off' | 'light' | 'strong';
  slowMo: boolean;
  playerSlots: number;
}

export interface Sim {
  readonly config: SimConfig;
  /** The tick about to be stepped (0 before the first step). */
  readonly tick: number;
  /** Advances one tick. `inputs` has one SimInput per player slot. */
  step(inputs: readonly SimInput[]): void;
  /** The state after the last step (a fresh object each call). */
  snapshot(): SimSnapshot;
  /** Events emitted by the last step, in emission order. */
  events(): readonly SimEvent[];
  /** FNV-1a over the whole sim state. */
  hash(): number;
  /** Legal only between steps; takes effect on the next tick. Unknown ids throw. */
  applyParam(id: string, value: number): void;
  isOver(): boolean;
}
