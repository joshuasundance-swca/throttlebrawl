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
  /**
   * Seconds of speed boost this rider has left from a `boostPad` (playtest 1b quick wins), 0 when
   * none; 0 for other kinds. Presentation only (a boost flame, speed lines). Optional for
   * hand-built snapshots; the sim fills it for every entity.
   */
  boostS?: number;
  /**
   * This racer's style run in progress (playtest 1c: "I'd like to also watch oncoming go up and up
   * as you ride"), for a live, ticking counter; null when none is running, and for other kinds.
   * Optional for hand-built snapshots; the sim fills it for every entity.
   */
  styleRun?: StyleRunSnapshot | null;
}

/**
 * A style run in progress (EntitySnapshot.styleRun): an oncoming stretch, or a jump in the air.
 * `cash` is what the run's `style` event will award if it ended now and counted: for an oncoming
 * stretch it rises every tick, and on the stretch's last tick it equals the coming event's `points`
 * exactly. For airtime it is the event's fixed cash; the seconds rise.
 */
export interface StyleRunSnapshot {
  kind: 'oncoming' | 'airtime';
  /** World seconds so far (slow motion stretches nothing). */
  seconds: number;
  /** Whole style cash it would score if it ended now and counted. */
  cash: number;
  /** Whether it has run long enough to score if it ended now (the event's minimum time). */
  qualifies: boolean;
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
  /**
   * The road set pieces' props in play (W-P events: roadwork cones, crash-scene flares, parade
   * floats' decorations, hay bales, the radar on a speed trap, the people who work them), from
   * sim/modifiers. Presentation only: render draws them, nothing else reads them. Optional for
   * hand-built snapshots; the sim always fills it (empty when no set piece is live).
   */
  props?: readonly PropSnapshot[];
}

/**
 * What a set-piece prop is (PropSnapshot.kind), a closed list render draws: traffic cones,
 * road flares, a sawhorse barricade, a warning sign (its words in `label`), a hay bale, a person
 * (a flagger, a cop waving traffic by, a marcher: `variant` says who), a radar unit on a tripod,
 * a giant parade inflatable, a work truck's arrow board, a tow truck's light bar, the hay stacked
 * on a farm truck, and a parade float's dressing (`variant` names the float).
 */
export const PROP_KINDS = [
  'cone',
  'flare',
  'barricade',
  'sign',
  'hayBale',
  'person',
  'radar',
  'inflatable',
  'arrowBoard',
  'lightbar',
  'hayLoad',
  'floatDecor',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/** One set-piece prop (SimSnapshot.props): a world position and pose, for render. */
export interface PropSnapshot {
  /** Stable for the prop's life in a race. */
  id: number;
  kind: PropKind;
  /** Who or which look: `flagger`, `cop`, `marcher-keys`, `float-sf`, ... ('' for none). */
  variant: string;
  /** A sign's words ('' for other kinds). */
  label: string;
  /** The content id of the event modifier the prop belongs to. */
  piece: string;
  /** World position of the prop's foot (x east, y up, z south). */
  x: number;
  y: number;
  z: number;
  /** World heading about +y, as EntitySnapshot.heading. */
  heading: number;
  /** Tip-over angle, radians: 0 upright, about π/2 lying on its side (a scattered cone). */
  tilt: number;
  /** A person stepping out of the way, or a prop knocked flying: render may animate it. */
  moving: boolean;
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
  /**
   * A pedestrian or animal reacts to a rider going by (W-P, 2026-10-01). Actor = the pedestrian,
   * target = the rider. `data.kind` is a `PedReactKind` and `data.ticks` how long the reaction
   * lasts, in ticks at timeScale 1. Presentation only reads it: nobody is hurt.
   */
  | 'pedReact'
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
  /**
   * A rider rode onto a `boostPad` (playtest 1b quick wins). Actor = the rider; `data.feature` is
   * the pad's feature id, `data.speed` the rider's speed on entry, m/s, and `data.holdS` how long
   * the boost lasts. One event per pad crossing.
   */
  | 'boost'
  | 'modifierStart'
  | 'modifierEnd';

/** `data.kind` of a `takedown` event: into traffic, into scenery, or out of health. */
export const TAKEDOWN_KINDS = ['traffic', 'scenery', 'health'] as const;
export type TakedownKind = (typeof TAKEDOWN_KINDS)[number];

/**
 * `data.kind` of a `pedReact` event (W-P): a hop back from the kerb, a shaken fist, a phone held
 * up to film the rider, or a dog running after the rider along the verge.
 */
export const PED_REACT_KINDS = ['jumpBack', 'fist', 'film', 'chase'] as const;
export type PedReactKind = (typeof PED_REACT_KINDS)[number];

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
  /**
   * The bike file's `combat.knockbackResistance`, 0..1 (M2 combat-3): the share of a landed hit's
   * shove this bike shrugs off. Absent means 0; buildSimConfig always writes it.
   */
  knockbackResistance?: number;
  /**
   * The bike file's `combat.hitPowerScale` (M2 combat-3): scales the shove this rider's hits give.
   * Absent means 1; buildSimConfig always writes it.
   */
  hitPowerScale?: number;
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
  /** Whom to fight first: `grudge`, `rival`, `player`, `leader`, `nearest`, `crew-enemy`. */
  targetPreference?: readonly string[];
  preferredSide?: 'left' | 'right' | 'either';
  /**
   * Authored rivalries (M4 rivals-1): the rider ids (bare, like `chad-speedwell`) this rider picks
   * a fight with whenever one is in range. Absent or empty: no authored rivals.
   */
  rivals?: readonly string[];
  /**
   * The weapon this rider goes out of its way to pick up (M4 rivals-1): a weapon id, matched against
   * the end of a weapon's content id (`chain` matches `base:chain`). Absent: it takes what it rides over.
   */
  preferredWeapon?: string;
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
  /**
   * The weapon this rider starts the race holding (the rider file's `startingWeapon`, qualified,
   * M4 cops-3: a cop's baton or taser, which can be stolen). Absent means bare-handed, as before.
   */
  startingWeapon?: string;
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
  /**
   * The registered behaviour id (the weapon file's `behaviour`, M4 weapons-2): `melee.swing`,
   * `melee.wrap` or `taser.stun`, a closed list in sim/combat. Absent or unknown is `melee.swing`.
   */
  behaviour?: string;
  /** Swings one held weapon gives before it is spent (`uses.charges`); absent or null: unlimited. */
  charges?: number | null;
  /** Landed hits before one held weapon breaks (`uses.durabilityHits`); absent or null: unlimited. */
  durabilityHits?: number | null;
  /** A landed hit's stun, in ticks (the `stun` entry of `effects`, `durationS`); absent: none. */
  stunTicks?: number;
  /**
   * Weight for the roadside pickups (`spawn.roadsideWeight`); 0 keeps it off the road (the cops'
   * baton and taser). Absent means 1 for a weapon that is not unarmed.
   */
  roadsideWeight?: number;
}

export interface SimTrafficTypeDef {
  contentId: string;
  category: 'car' | 'truck' | 'rv' | 'oddity' | 'pedestrian' | 'animal';
  lengthM: number;
  widthM: number;
  cruiseMps: number;
  hazard: 'normal' | 'big';
  /**
   * How often traffic (or peds) picks this type, relative to the others in its pool: the weight
   * the event's region file gives the type in `traffic.mix`, `pedestrians` or `animals`; 0 when
   * the region lists it nowhere, so it is never picked (M2 traffic-3). Absent in hand-built
   * configs, which means the sim's own category default. buildSimConfig always writes it.
   */
  weight?: number;
  /**
   * The type's behaviour flags (W-P, 2026-10-01). Optional: absent, and any absent flag, means the
   * category's default. buildSimConfig copies the flags the content gives.
   */
  behaviour?: SimTrafficBehaviour;
}

/** A traffic type's behaviour flags (docs/content-packs.md, "Traffic type"). */
export interface SimTrafficBehaviour {
  /** Rare seeded lane changes. Absent: the category's default (cars change lanes, others do not). */
  laneChanges?: boolean;
  /**
   * Rides at the kerb: the shoulder where there is one, else the outer edge of the outermost lane
   * (bicycles, e-bikes, scooters, golf carts). Other vehicles pass it in their lane.
   */
  kerb?: boolean;
  /** A seeded side-to-side weave as it rides, metres either way (e-scooters). */
  weaveM?: number;
  /** Spawns as a convoy of up to this many of its kind, nose to tail (an RV convoy). */
  convoy?: number;
  /** A pedestrian or animal that walks or jogs along the verge rather than crossing the road. */
  strolls?: boolean;
  /** An animal that runs after a passing rider a short way along the verge (dogs). */
  chases?: boolean;
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
  /**
   * The event's style-cash values (M2 riders-5), from its `rewards` block. Optional for hand-built
   * configs, where absent means every source scores 0; buildSimConfig always writes it.
   */
  style?: SimStyleRewards;
  /** The event's career tier, 1 for the first (M4). Absent means 1. */
  tier?: number;
  /**
   * The event file's `cops` block (docs/content-packs.md, "Event"; M4 cops-3). Absent keeps the
   * M2 rule: every fielded cop rolls to come out at the spawn delay.
   */
  cops?: SimEventCops;
  /**
   * The most event modifiers (set pieces) that may fire in one race: the event file's
   * `modifiers.maxPerRace` (W-P events). Absent means no cap beyond `SimConfig.modifiers`.
   */
  modifiersPerRace?: number;
}

/**
 * How the law turns up in a race (M4 cops-3): the decided mix of tier-rising, every-race and
 * chaos-summoned, with some randomness. buildSimConfig fields enough cops for the most this can
 * bring out; sim/cops decides which of them leave the lot, and when.
 */
export interface SimEventCops {
  mode: 'none' | 'every-race' | 'tier-rising' | 'chaos-summoned';
  /** Cops that come out at the start of the chase (`baseCount`; 0 when absent). */
  baseCount: number;
  /** Extra cops per tier above the first (`tierScale`; 0 when absent). */
  tierScale: number;
  /** Mayhem can summon cops in any mode (`chaosSummon`); `chaos-summoned` implies it. */
  chaosSummon: boolean;
  /** 0..1: jitters the counts and the timing (`randomness`; 0 when absent). */
  randomness: number;
  /**
   * Playtest 2 (2026-10-02, "I think I've only ever encountered cops once"): the cops who come out
   * at the start PATROL instead of leaving the lot behind the grid. Each waits on the shoulder at a
   * point ahead that the field reaches early in the race, lights up as a player comes near, and falls
   * in behind. The race rolls how many, from `baseCount` up to `patrolMax` (`patrolMax`; absent or 0:
   * no patrol, the lot rule).
   */
  patrolMax?: number;
}

/**
 * Style cash per source, from the event file's `rewards` style fields (docs/content-packs.md,
 * "Event"); each is 0 when the file leaves it out. sim/race scores them as `style` events.
 */
export interface SimStyleRewards {
  perNearMissCash: number;
  perAirtimeCash: number;
  perOncomingSecondCash: number;
  /** A takedown's base cash; a combo's k-th takedown scores it × `takedownComboScale` × k. */
  perTakedownCash: number;
  takedownComboScale: number;
  perStealCash: number;
}

/**
 * One effect of an event modifier, as its pack entry gives it (docs/content-packs.md, "Event
 * modifiers"): `kind` is from the closed list sim/modifiers implements, and the other fields are
 * that kind's plain parameters (numbers, strings, booleans or lists of strings).
 */
export interface SimModifierEffect {
  readonly kind: string;
  readonly [param: string]: number | string | boolean | readonly string[] | undefined;
}

/** An event modifier resolved from its `event-modifier` entry (SimConfig.modifiers). */
export interface SimModifierDef {
  /** Qualified content id, such as `region-pnw:hay-spill`. */
  contentId: string;
  /** `nature`, `human`, `wasteland` or `league`. */
  kind: string;
  /** Chance per race that it fires (the entry's `trigger.chance` × the event's `chanceScale`, ≤ 1). */
  chance: number;
  /** The race-progress window (0..1) it may be placed in; [0, 1] when the entry gives none. */
  atProgress: readonly [number, number];
  /** How long it lasts once started, in ticks (`durationS`); 0 means until the riders are past. */
  durationTicks: number;
  /** Relative pick weight (`rarityWeight`). */
  weight: number;
  effects: readonly SimModifierEffect[];
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
  /**
   * Resolved event modifiers (docs/architecture.md, "Event modifiers"): the `event-modifier`
   * entries the event opted into and whose eligibility matched, in id order. sim/modifiers rolls
   * which of them fire, and where, from the `modifiers` stream. Empty when the event opts out.
   */
  modifiers: readonly SimModifierDef[];
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
