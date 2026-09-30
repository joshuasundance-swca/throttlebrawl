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
  /**
   * A rider's bike while it stands apart from them: parked after a crash hand-back while the rider
   * runs back to it on foot (tumble-1), else null. World position and heading, in the same frame as
   * the entity's own. Optional for hand-built snapshots; the sim fills it for every rider.
   */
  parkedBike?: ParkedBikeSnapshot | null;
  /**
   * A rider's crash bodies while it tumbles (mode `Tumble`), else null: the rider's and the bike's
   * world-space centres and velocities, so render can throw the bike clear and cartwheel it apart
   * from the rider (M2 render-2). Presentation only. Optional for hand-built snapshots; the sim
   * fills it for every rider from the tumble system's own bodies (tumble-1's today, tumble-2's rig
   * centres when it lands).
   */
  tumble?: TumbleSnapshot | null;
  /**
   * Style cash this rider has scored this race (M2 riders-5), 0 for other kinds. Optional for
   * hand-built snapshots; the sim fills it for every entity.
   */
  styleTally?: number;
  /**
   * Entity ids of the riders who noted a grudge against this rider this race, in the order noted
   * (M2 tumble-2; the HUD's "grudge noted" marker). Empty for other kinds. Optional for
   * hand-built snapshots; the sim fills it for every entity.
   */
  grudgeNotedBy?: readonly EntityId[];
}

/** A takedown's slow motion (M2 combat-4): whether it runs, and its raw ticks left. */
export interface SlowmoSnapshot {
  active: boolean;
  remainingTicks: number;
}

/** Where a parked bike stands, for render (EntitySnapshot.parkedBike). */
export interface ParkedBikeSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
}

/** One crash tumble body: world position (x east, y up, z south) and velocity in m/s. */
export interface TumbleBodySnapshot {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** A tumbling rider's two bodies (EntitySnapshot.tumble). */
export interface TumbleSnapshot {
  rider: TumbleBodySnapshot;
  bike: TumbleBodySnapshot;
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
  /** The takedown slow motion. Optional for hand-built snapshots; the sim always fills it. */
  slowmo?: SlowmoSnapshot;
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
  /**
   * The steal cue: a held weapon's wind-up has reached its snatch window (render glints, audio
   * cues). Actor = the holder, target = its current target when it has one; `data.weapon`, and
   * `data.ticks`, the window's length in ticks at timeScale 1. The attack's causeId.
   */
  | 'stealWindow'
  /** A rider lost stability without going down (barrier scrape, rough landing, a first contact). */
  | 'wobble'
  | 'crash'
  /**
   * A rider went down within the attribution window of someone's hit (M2 combat-4). Actor = the
   * rider credited, target = the rider who went down; `data.kind` is a `TakedownKind`. The
   * causeId is the crash's (or the finishing hit's, for `health`).
   */
  | 'takedown'
  | 'nearMiss'
  | 'bust'
  /** The cop's siren cue for audio: `data.on` is true when a chase starts, false when it ends. */
  | 'siren'
  | 'jump'
  | 'land'
  | 'pedDive'
  | 'cashAward'
  /**
   * Risky riding scored (M2 riders-5; emitted by sim/race). Actor = the rider who scored;
   * `data.kind` is a `StyleKind` and `data.points` the style cash it adds to that rider's tally
   * (a number, in the event's cash units, from the event's `rewards`). The causeId is the source
   * event's where there is one (the near miss, the landing, the takedown, the grab).
   */
  | 'style'
  /**
   * A takedown's slow motion begins (M2 combat-4): actor = the rider credited, target = the rider
   * who went down, causeId = the takedown's. `data.ticks` is its length in raw ticks and
   * `data.timeScale` the scale it runs at.
   */
  | 'slowmoStart'
  /** The slow motion ends: the same actor, target and causeId as its `slowmoStart`. */
  | 'slowmoEnd'
  /**
   * A tumble body crossed a `rail` barrier (M2 tumble-2). Actor = the rider; `data.body` is
   * `rider` or `bike`. The causeId is the crash's.
   */
  | 'railOver'
  /**
   * A body that went over the rail reached the water plane (world y = 0). Actor = the rider;
   * `data.body` as for `railOver`, and `data.penaltyTicks` the time penalty before the respawn.
   */
  | 'splash'
  /**
   * A rider is put back on the road away from where they went down (after a splash, M2). Actor =
   * the rider; `data.reason` names why (`splash`). The causeId is the crash's.
   */
  | 'respawn'
  /** A knocked-off rider stands up after the tumble settles (M2 tumble-2). Actor = the rider. */
  | 'getUp'
  /**
   * The stood-up rider shakes a fist. Actor = the rider; target = whom they blame (the rider
   * credited with knocking them off) when there is one.
   */
  | 'fistShake'
  /**
   * A knocked-off rival notes a grudge for the rest of the race (M2 tumble-2 emits it, ai-2 reads
   * it). Actor = the rival holding the grudge; target = the rider it is against.
   */
  | 'grudgeNoted'
  | 'modifierStart'
  | 'modifierEnd';

/** `data.kind` of a `takedown` event: into traffic, into scenery, or out of health. */
export const TAKEDOWN_KINDS = ['traffic', 'scenery', 'health'] as const;
export type TakedownKind = (typeof TAKEDOWN_KINDS)[number];

/** `data.kind` of a `style` event: the five style-cash sources (docs/milestones/M2.md). */
export const STYLE_KINDS = ['nearMiss', 'airtime', 'oncoming', 'takedownCombo', 'weaponSteal'] as const;
export type StyleKind = (typeof STYLE_KINDS)[number];

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
 * A rider's own personality numbers (docs/content-packs.md, "Rider"), resolved from its file. They
 * override the style preset's values in sim/ai; a missing field keeps the preset's. Numbers are 0..1.
 */
export interface SimAiPersonality {
  aggression?: number;
  dirtiness?: number;
  courage?: number;
  riskTaking?: number;
  chatter?: number;
  /** Lane habit: how much the rider drifts across its lane (0 holds a line). */
  weave?: number;
  /** Whom to fight first: `grudge`, `player`, `leader`, `nearest`, `crew-enemy`. */
  targetPreference?: readonly string[];
  preferredSide?: 'left' | 'right' | 'either';
}

/**
 * Who drives a rider. `cop` is an in-sim AIController like `ai`, but sim/cops runs it in the cops
 * phase, so its command takes effect on the next tick; the controllers phase leaves it alone.
 */
export type SimController =
  | { kind: 'player'; slot: number }
  | { kind: 'ai'; style: string; personality?: SimAiPersonality }
  | { kind: 'cop' };

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
  /**
   * The event length raced (`short`, `standard`, `long`; M2 riders-5) and its route's content id,
   * so a replay header names the route to rebuild. Optional for hand-built configs; buildSimConfig
   * always writes both.
   */
  lengthId?: string;
  routeId?: string;
}

/** Resolved difficulty scales, 1.0 = Normal. The preset id travels for display only. */
export interface SimDifficulty {
  presetId: string;
  riderAggression: number;
  copFrequency: number;
  rubberBand: number;
}

/** Steering assist strength (M2 riders-4): nudges yaw away from the shoulder and barriers. */
export type SimSteerAssist = 'off' | 'light' | 'strong';

/** One human slot's assists (M2 riders-4). Independent of the input method. */
export interface SimAssists {
  steer: SimSteerAssist;
  /** The sim holds full throttle for this slot (the input's throttle is ignored). */
  autoThrottle: boolean;
}

/** Per player slot settings that are sim state (M2). AI riders have no slot and ignore them. */
export interface SimSlotConfig {
  assists: SimAssists;
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
  /**
   * The M1 placeholder, superseded by `slots[i].assists` in M2 and read by nothing. Kept so the
   * lanes' hand-built test configs still compile; removed once none sets it.
   */
  assists: SimSteerAssist;
  /** The takedown slow motion toggle (on by default in buildSimConfig; combat-4 reads it). */
  slowMo: boolean;
  playerSlots: number;
  /**
   * Per player slot, index = slot (M2). Absent or short means no assists for the missing slots;
   * sim code reads it through `slotAssists(config, slot)` in sim/world. buildSimConfig always
   * writes it, so the replay header carries it.
   */
  slots?: readonly SimSlotConfig[];
  /**
   * The lower-overall-speed multiplier m (M2 riders-4), in (0, 1]; absent means 1. It scales every
   * mover's speed and acceleration (gravity by m²), never the time scale, and changes only between
   * races. Sim code reads it through `speedMultiplierOf(config)` in sim/world.
   */
  speedMultiplier?: number;
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
