// The sim contract's types (docs/architecture.md, "Sim contract"). Re-exported by src/sim/api.ts,
// which is the only file outside src/sim may import. Field lists are the architecture doc's
// minimum plus what the M1 lanes need; the contract owner may add fields in a contract PR.
import type { EntityId, GroundSurface, GrudgeRuleId, SmashableKind, TuningValues } from '../core';
import type { RoadNetwork, RouteProgress } from '../road';

export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

// ---- Input -------------------------------------------------------------------------------

/**
 * Flag bits of SimInput.flags (16 bits from playtest 3; quantizeInput keeps 0xffff). `grab` is
 * reserved; `lookBack` and `pause` are ignored by the sim. `wheelie` (playtest 3, "a way to do
 * wheelies"; the maintainer's gesture: double-tap the throttle, then balance it by thumb height) is
 * a level flag, held while the double-tap's second press is held; sim/riders/wheelie.ts reads its
 * rising edge to pop the front, and only for a player.
 */
export const InputFlag = {
  attack: 1,
  attackSideLeft: 2,
  attackSideRight: 4,
  kick: 8,
  grab: 16,
  lookBack: 32,
  skipRunBack: 64,
  pause: 128,
  wheelie: 256,
} as const;

/** One player slot's command for one tick, quantized so recordings are exact. */
export interface SimInput {
  /** int8, -127 (full left) .. 127 (full right). */
  steer: number;
  /** uint8, 0..255. */
  throttle: number;
  /** uint8, 0..255. */
  brake: number;
  /** InputFlag bits, uint16. */
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
  /**
   * The bike's pitch, radians, nose up positive, from the horizontal (playtest 2, 2026-10-02: air
   * control and flips): the road's slope along the travel direction while grounded, the bike's own
   * attitude in the air. A flip runs on past ±2π (unwrapped) until the landing; render rotates the
   * bike about its own lateral axis by it. 0 for other kinds. Optional for hand-built snapshots; the
   * sim fills it for every entity.
   */
  pitch?: number;
  /**
   * The trick this rider is doing in the air right now (a `TrickId`), for poses and the HUD; null on
   * the ground, in plain flight, and for other kinds. Optional for hand-built snapshots; the sim
   * fills it for every entity.
   */
  trick?: TrickId | null;
  /**
   * Where a rider in the air will touch down (the pitch deck's #13, "Air that pays": "a chalk mark
   * shows where you'll touch down, red if you're crooked"), forecast by sim/riders from its flight;
   * null on the ground, for riders no player drives, and for other kinds. Presentation only.
   * Optional for hand-built snapshots; the sim fills it for every entity.
   */
  touchdown?: TouchdownSnapshot | null;
  /**
   * This rival's signature move while it shows (interview, 2026-10-02: "Visible personalities"),
   * so render can draw it (Chad's phone up, the Mayor's wave, Gus's bell swinging); null while it
   * is not showing one, and for other kinds. Presentation only. Optional for hand-built snapshots;
   * the sim fills it for every entity.
   */
  signature?: SignatureSnapshot | null;
  /**
   * What a rider's wheels are on (W-Q; interview, 2026-10-02: "Anywhere with ground"): the road's
   * surface on its lanes, `shoulder` on a paved shoulder, a verge band's surface off the road, null
   * in the air and for other kinds. Optional for hand-built snapshots; the sim fills it for every
   * entity.
   */
  ground?: GroundSurface | null;
  /**
   * The heading sign on the route (W-Q U-turns): 1 travelling toward the finish, -1 after a U-turn
   * (and for traffic coming the other way); 1 off the route. It is `road.dir` times the route's
   * orientation of the edge. Optional for hand-built snapshots; the sim fills it for every entity.
   */
  routeDir?: 1 | -1;
  /**
   * The id of the route branch a rider is on (W-Q junction choices and marked shortcuts:
   * `RouteBranch.id`), or null on the main path and for other kinds. Optional for hand-built
   * snapshots; the sim fills it for every entity.
   */
  branch?: string | null;
  /**
   * The wheelie's angle above the slope, radians (playtest 3, sim/riders/wheelie.ts), 0 when the
   * front wheel is down, and for other kinds. `pitch` already includes it, so render rotates the
   * bike once; this is for the rig's rear-contact pivot and the HUD gauge. Optional for hand-built
   * snapshots; the sim fills it for every entity.
   */
  wheelie?: number;
  /**
   * The drift's slip angle, radians (playtest 3, sim/riders/drift.ts): positive when the nose points
   * to the right of the rider's travel, 0 when not drifting, and for other kinds. Render draws the
   * bike at yaw + drift. Optional for hand-built snapshots; the sim fills it for every entity.
   */
  drift?: number;
}

/**
 * The player's new moves as the HUD sees them (SimSnapshot.moves; playtest 3): the wheelie gauge
 * beside the stick and the drift chain on the ticker's meter.
 */
export interface MovesSnapshot {
  /** World seconds of the wheelie in progress, 0 when none. */
  wheelieS: number;
  /** Where the wheelie sits: under the sweet band, in it, over it (a loop-out warning), or null. */
  wheelieBand: 'low' | 'sweet' | 'high' | null;
  /** World seconds of the drift in progress, 0 when none. */
  driftS: number;
  /** The chain's length so far (1 for a lone drift), 0 when no chain is open. */
  driftChain: number;
  /** Unbanked drift style cash: banked by a `driftEnd` with points, emptied by a crash or wobble. */
  driftCash: number;
  /** The drift's side, 1 right or -1 left, 0 when not drifting. */
  driftSide: -1 | 0 | 1;
}

/**
 * A moving deck (playtest 3, "the ramp trucks could be in motion"): a vehicle whose ramp is down,
 * published each tick by sim/modifiers into the registry `systemState(world, MOVING_DECKS_KEY)`
 * (a `SimMovingDecks`). Riders read its ramp like a parked ramp truck's (sim/riders/features.ts);
 * traffic's contacts skip the vehicle while it has a live entry, so the riders' deck rules own that
 * contact. Positions are along the vehicle's road at its current spot.
 */
export interface SimMovingDeck {
  /** The vehicle's entity id. */
  vehicle: EntityId;
  /** The road edge it drives on, and where its ramp's foot is along it, m. */
  edge: number;
  s0: number;
  /** Its travel direction along the edge. */
  dir: 1 | -1;
  /** Its lateral extent, m. */
  d0: number;
  d1: number;
  speedMps: number;
  rampLengthM: number;
  lipHeightM: number;
  /** The body's length past the lip, m. */
  bodyM: number;
}

/** The moving-deck registry (SimMovingDeck): the decks live this tick. */
export interface SimMovingDecks {
  live: SimMovingDeck[];
}

/**
 * The `systemState` key of the moving-deck registry. Only its writer (sim/modifiers) creates it;
 * readers look it up in `world.systems` without creating it, so a race with no moving deck hashes
 * as before.
 */
export const MOVING_DECKS_KEY = 'decks';

/**
 * A rival's signature move (interview, 2026-10-02: "Visible personalities"): one move per rival,
 * named by the rider file's `personality.signature`, that is both a tell and an opening. sim/ai
 * drives them; docs/content-packs.md ("Rider") says what each one does.
 *   - `selfie`: rides no-hands filming himself for about 3 s; he cannot swing (Chad Speedwell);
 *   - `wave`: waves at traffic and drifts into the oncoming lane (The Mayor);
 *   - `bell`: a bell swings before every hit he throws (Gripman Gus);
 *   - `counter`: brakes precisely to drop alongside whoever hit him, then counterattacks (Kevin);
 *   - `lag`: twitches, freezes on the throttle for a moment, then lurches back (Dial-Up);
 *   - `ram`: swings wide, then rams her bike into you (Mother Rust);
 *   - `slow-burn`: will not fight until he has been hit enough, then never stops (Deacon Vane);
 *   - `sweet-talk`: rides beside you being nice, then shoves (Tammy Two-Stroke);
 *   - `cut-in`: cuts into the gap in front of you and brake-checks (Juniper Moss);
 *   - `timber`: puts his head down and charges whoever is ahead in his line (Old Growth);
 *   - `pivot`: signals, swaps sides with a burst, then his battery sags (Pivot).
 */
export const SIGNATURE_IDS = [
  'selfie',
  'wave',
  'bell',
  'counter',
  'lag',
  'ram',
  'slow-burn',
  'sweet-talk',
  'cut-in',
  'timber',
  'pivot',
] as const;
export type SignatureId = (typeof SIGNATURE_IDS)[number];

/**
 * Where a signature move is: `tell` (the warning you can read), `act` (the move itself) or `open`
 * (the window after it, when the rival is easy to punish). Not every move has all three.
 */
export const SIGNATURE_PHASES = ['tell', 'act', 'open'] as const;
export type SignaturePhase = (typeof SIGNATURE_PHASES)[number];

/** A signature move showing now (EntitySnapshot.signature). */
export interface SignatureSnapshot {
  move: SignatureId;
  phase: SignaturePhase;
  /** World seconds since this phase began. */
  seconds: number;
  /** World seconds left in this phase, or -1 when it lasts until something happens. */
  left: number;
  /** Whom the move is aimed at, or -1 for nobody in particular. */
  targetId: EntityId;
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

/**
 * A forecast touch-down (EntitySnapshot.touchdown): the point on the ground below the flight where
 * the bike will land if nothing changes, in world coordinates (x east, y up, z south), the bike's
 * world heading there, the world seconds until it lands, and whether landing as the bike is now
 * would be crooked (a wobble or worse: sideways, off the slope, leaned over, or still holding the
 * newspaper).
 */
export interface TouchdownSnapshot {
  x: number;
  y: number;
  z: number;
  heading: number;
  inS: number;
  crooked: boolean;
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
   * hand-built snapshots; the sim always fills it (empty when no set piece is live). From run W-T
   * (law with a personality) sim/cops adds its own: the END OF JURISDICTION sign (`sign`, variant
   * `jurisdiction`, `piece` the agency's crew id) and a radar trooper's radar (`radar`, variant
   * `trooper`), with ids from LAW_PROP_ID_BASE up so they never collide with a set piece's.
   */
  props?: readonly PropSnapshot[];
  /**
   * The law (playtest 2, 2026-10-02: the heat meter), for the player in slot 0, from sim/cops. The
   * HUD's heat badge reads it. Optional for hand-built snapshots; the sim always fills it.
   */
  law?: LawSnapshot;
  /**
   * The roadside smashables near the players (run W-T, "the road fights back": lobster traps,
   * mailboxes, parking meters and the rest), from sim/smash: intact or smashed, for render. Optional
   * for hand-built snapshots; the sim always fills it (empty when the race has none).
   */
  smashables?: readonly SmashableSnapshot[];
  /**
   * The player in slot 0's wheelie and drift (playtest 3), for the HUD, like `law` (all zero while
   * neither move runs); null when no player rides. Optional for hand-built snapshots; the sim
   * always fills it.
   */
  moves?: MovesSnapshot | null;
}

/** One roadside smashable (SimSnapshot.smashables): where it stands, and whether it is smashed. */
export interface SmashableSnapshot {
  /** Stable for the race. */
  id: number;
  kind: SmashableKind;
  /** The takedown name its region file gives it ('CATCH OF THE DAY'). */
  name: string;
  /** World position of its foot (x east, y up, z south) and its heading about +y, facing the road. */
  x: number;
  y: number;
  z: number;
  heading: number;
  /** The tick it was smashed, or -1 while it stands. */
  smashedTick: number;
  /** The world velocity of what hit it (x and z, m/s), 0 while it stands: its debris flies that way. */
  hitVx: number;
  hitVz: number;
}

/** The heat meter as presentation sees it (SimSnapshot.law). */
export interface LawSnapshot {
  /** How hot the player is, 0 (clean) to 1 (the top of the meter). */
  heat: number;
  /** The heat tier: 0 none, 1 one more cop, 2 the pursuit pair, 3 the roadblock. */
  tier: number;
  /** True once a chase has been shaken off this race and the heat has not risen since ("Lost 'em"). */
  lost: boolean;
  /**
   * Citations written to the player this race by a `citations` cop (run W-T: Deputy Lindqvist),
   * and their total cash, billed at the finish (a `law` event, kind `bill`). Optional for hand-built
   * snapshots; the sim always fills them (0 and 0 with no such cop).
   */
  citations?: number;
  citationCash?: number;
}

/** Prop ids sim/cops gives its props (the jurisdiction sign, a trooper's radar) start here. */
export const LAW_PROP_ID_BASE = 1_000_000;

/**
 * A cop's pursuit habit (the pitch deck's #11, "Law with a personality", run W-T), from the rider
 * file's `law.habit.kind`; content's LAW_HABITS is the same list (the app tests check). [default]
 * - `relentless` (Sgt. Pruitt): the longer he chases, the closer he holds, the sooner he moves in
 *   and the harder he rides to catch up;
 * - `radar` (Trooper Dalrymple): on patrol he waits at the route's first long bridge with a radar,
 *   lights up only for a player clocked over the limit, and lets one under it ride by;
 * - `citations` (Deputy Lindqvist): never rams (he rides alongside out of bumping range) and writes
 *   a citation for every few seconds alongside, billed at the player's finish;
 * - `budget` (Officer Meter): his chasing comes out of a pursuit budget; spent, he pulls over for
 *   good.
 */
export const LAW_HABIT_IDS = ['relentless', 'radar', 'citations', 'budget'] as const;
export type LawHabitId = (typeof LAW_HABIT_IDS)[number];

/** A cop's habit as the sim reads it (SimLawDef.habit). */
export interface SimLawHabit {
  kind: LawHabitId;
  /**
   * The habit file's numbers by name (`rampS`, `everyS`, `cashEach`, `budgetS`, `limitMps`, ...).
   * sim/cops documents each and falls back to its own default for one that is absent.
   */
  params: Readonly<Record<string, number>>;
}

/**
 * What a set-piece prop is (PropSnapshot.kind), a closed list render draws: traffic cones,
 * road flares, a sawhorse barricade, a warning sign (its words in `label`), a hay bale, a person
 * (a flagger, a cop waving traffic by, a marcher: `variant` says who), a radar unit on a tripod,
 * a giant parade inflatable, a work truck's arrow board, a tow truck's light bar, the hay stacked
 * on a farm truck, and a parade float's dressing (`variant` names the float).
 * Run W-T (the pitch deck's #9, "weird events that move"): a log shed by a log truck, lying across
 * the road with its long axis across it (`tilt` is how far it has rolled, unbounded; `moving` while
 * it rolls), and an overhead gantry over the road for a lane vote (`label` is its two panels' words,
 * the rider's left then right, split by ' | '; `variant` is '' until the vote, then `left` or
 * `right`, the side that won; `spanM` its width). A serial sign (one joke over four small signs) is
 * a `sign` whose `variant` is `serial`.
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
  'log',
  'gantry',
] as const;
export type PropKind = (typeof PROP_KINDS)[number];

/**
 * A moving set piece's moment (run W-T, `setPieceBeat` events' `data.beat`): a boat trailer comes
 * unhitched, a cable car loses its grip, a log truck starts shedding its load, a lane vote is cast.
 */
export const SET_PIECE_BEATS = ['unhitch', 'runaway', 'shed', 'vote'] as const;
export type SetPieceBeat = (typeof SET_PIECE_BEATS)[number];

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
  /** A gantry's width across the road, m (run W-T). Absent for every other kind. */
  spanM?: number;
}

// ---- Events ------------------------------------------------------------------------------

export type SimEventType =
  | 'raceStart'
  | 'raceEnd'
  | 'finish'
  | 'overtake'
  | 'lapOrCheckpoint'
  /**
   * A player came off a shortcut for the first time this race (W-Q, the pitch deck's item 9: "your
   * first time down a shortcut stamps the seconds it really saved"). Actor = the player;
   * `data.toEdge` the shortcut's first edge (its split zone's link), `data.gainM` the metres of
   * route it cut, `data.savedS` the seconds that saved at the rider's average speed along it
   * (gainM / that speed, 0.1 s steps), `data.shortcutS` the seconds spent on it. Presentation only
   * reads it (the 'found it' stamp).
   */
  | 'shortcutFound'
  | 'attackStart'
  | 'attackMiss'
  | 'hit'
  | 'kick'
  | 'weaponGrab'
  /**
   * A held weapon left the hand, thrown (run W-T, the pitch deck's #4: "Kevin's briefcase is thrown
   * and bursts into paperwork"). Actor = the thrower, who holds nothing from this tick; target = the
   * rider it is aimed at, when there is one; `data.weapon`, and `data.pickup`, the pickup entity
   * that now flies (the snapshot carries it like any pickup). The throw's causeId (its
   * attackStart's), which the later `hit` or `attackMiss` (`data.thrown`, `data.burst`) shares.
   */
  | 'throw'
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
  /**
   * The heat tier changed (playtest 2, sim/cops). Actor = the player; `data.tier` is the new tier
   * (0 to 3), `data.from` the old one and `data.heat` the meter, 0..1. A drop to tier 0 from a chase
   * carries `data.lost: true` (the chasing cops give up).
   */
  | 'heat'
  /**
   * A cop's habit showed (run W-T, law with a personality; sim/cops). Actor = the cop, target = the
   * player; `data.kind` is a `LawEventKind`:
   * - `relentless`: he stepped it up (`data.level` 1, then 2 at the top of his ramp);
   * - `radar`: he clocked a player passing his radar (`data.mps`, `data.limitMps`, `data.over`);
   * - `citation`: he wrote one (`data.count` so far from him, `data.cashEach`, `data.totalCash` the
   *   player's whole bill so far from every cop);
   * - `bill`: the player finished owing citations (`data.count`, `data.totalCash`), once per player
   *   and race; the career charges it;
   * - `budgetOut`: his pursuit budget ran out and he pulled over for good (`data.budgetS`);
   * - `jurisdiction`: the player crossed the END OF JURISDICTION sign (`data.heatBefore` 0..1); the
   *   actor is the nearest cop who was on him and pulled over, or the player when none was.
   */
  | 'law'
  | 'jump'
  /**
   * A rider came down from the air. Actor = the rider; `data.quality` (`clean`, `wobble`, `crash`),
   * `data.airTicks`, `data.trick` and `data.flips` (playtest 2). From the pitch deck's #13 ("Air
   * that pays"): a clean landing after real air carries `data.surge` (true) and `data.surgeS`, the
   * seconds of the short surge it gives (riders and rivals alike), which ride on the rider's boost
   * (`EntitySnapshot.boostS`). A player landing within a bike length of another rider also lands a
   * heavy hit on him: a `hit` event whose `data.weapon` is `landing`, the landing's causeId.
   */
  | 'land'
  /**
   * A wheelie into a car launched the rider (playtest 3: "wheelie into the hood of a car... launch
   * you up into a jump doing backflips"; sim/riders/wheelie.ts). Actor = the rider, target = the
   * vehicle (absent for a parked road hazard, whose feature id is `data.feature`); `data.part` is
   * `hood` (the car came at the rider) or `trunk` (it drove the rider's way), `data.closingMps`,
   * `data.vyMps` and `data.flips`, the backflips the launch spins. The `jump` that starts the flight
   * carries `data.hood`, and so does its `land`.
   */
  | 'hoodLaunch'
  /**
   * A wheelie ended (playtest 3). Actor = the rider; `data.seconds` (world time up), `data.sweetS`
   * (of those, in the sweet band), `data.clean` (the front came down gently) and `data.loopOut`
   * (it went over backwards, with a `crash` whose `cause` is `wheelie`). sim/race scores a clean one
   * of at least `race.styleWheelieMinS` as a `wheelie` style event.
   */
  | 'wheelieEnd'
  /** A drift began (playtest 3, sim/riders/drift.ts). Actor = the rider; `data.side` and `data.speed`. */
  | 'driftStart'
  /**
   * A drift ended. Actor = the rider; `data.seconds`, `data.clean`, `data.chain` (its place in the
   * chain), `data.boostMps` (the exit boost, 0 for none) and `data.points`: the chain's style cash,
   * above 0 only on the end that banks it (sim/race scores it as a `drift` style event).
   */
  | 'driftEnd'
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
   * Dial-Up's "Bad Connection" (run W-T, the pitch deck's #14; a grudge match whose
   * `SimEventDef.grudgeRule` is `bad-connection`). Actor = the rival. `data.phase` is `screech` (the
   * warning: his lag move's tell begins, audio plays the modem screech), `drop` (the connection
   * drops: he freezes, as `EntitySnapshot.signature` shows) or `reconnect` (he is back, moved
   * `data.jumpM` metres up the road along his edge; 0 when the road ahead was not clear).
   * Presentation reads it; the career does not.
   */
  | 'badConnection'
  /**
   * A rider rode onto a `boostPad` (playtest 1b quick wins). Actor = the rider; `data.feature` is
   * the pad's feature id, `data.speed` the rider's speed on entry, m/s, and `data.holdS` how long
   * the boost lasts. One event per pad crossing.
   */
  | 'boost'
  /**
   * A roadside smashable broke (run W-T, "the road fights back"). `data.prop` is its id (as in
   * SimSnapshot.smashables), `data.kind` its `SmashableKind`, `data.name` its takedown name, and
   * `data.takedown` whether a rider knocked into it went down. With `data.takedown` true, actor =
   * the rider whose hit sent them (the one combat credits) and target = the rider who went down; the
   * causeId is that crash's, so the `takedown` that follows (kind `scenery`) shares it. Otherwise
   * actor = the rider who rode (or tumbled) through it, and there is no target.
   */
  | 'smash'
  | 'modifierStart'
  | 'modifierEnd'
  /**
   * A moving set piece's moment (run W-T, the pitch deck's #9): the skiff comes off its trailer, the
   * cable car loses its grip, the log truck starts shedding, a lane vote is cast. Actor = -1, or the
   * vehicle that does it; target = the voter for a vote. `data.beat` is a `SetPieceBeat`,
   * `data.piece` the piece's name and `data.id` its modifier's content id; a vote adds `data.side`
   * (`left` or `right`) and `data.pick`, the content id of the event it picked. Presentation only
   * reads it (a bell, a bark, a camera nudge).
   */
  | 'setPieceBeat';

/** `data.kind` of a `takedown` event: into traffic, into scenery, or out of health. */
export const TAKEDOWN_KINDS = ['traffic', 'scenery', 'health'] as const;
export type TakedownKind = (typeof TAKEDOWN_KINDS)[number];

/**
 * `data.kind` of a `pedReact` event (W-P): a hop back from the kerb, a shaken fist, a phone held
 * up to film the rider, or a dog running after the rider along the verge.
 */
export const PED_REACT_KINDS = ['jumpBack', 'fist', 'film', 'chase'] as const;
export type PedReactKind = (typeof PED_REACT_KINDS)[number];

/** `data.kind` of a `law` event (run W-T, law with a personality): which habit showed. */
export const LAW_EVENT_KINDS = [
  'relentless',
  'radar',
  'citation',
  'bill',
  'budgetOut',
  'jurisdiction',
] as const;
export type LawEventKind = (typeof LAW_EVENT_KINDS)[number];

/**
 * `data.kind` of a `style` event: the five style-cash sources (docs/milestones/M2.md), `trick`
 * (playtest 2, 2026-10-02: "I love the idea of doing flips"), a trick landed, with `data.trick` its
 * `TrickId` and `data.flips` the full turns for a flip, and playtest 3's `wheelie` (a clean wheelie,
 * by the second) and `drift` (a drift chain banked). The product spec's style sources include
 * "maybe other stuff" `[decided]`.
 */
export const STYLE_KINDS = [
  'nearMiss',
  'airtime',
  'oncoming',
  'takedownCombo',
  'weaponSteal',
  'trick',
  'wheelie',
  'drift',
] as const;
export type StyleKind = (typeof STYLE_KINDS)[number];

/**
 * The tricks a rider can do in the air (playtest 2, 2026-10-02): a backflip or front flip (a full
 * turn of the bike, nose up or nose down), a wheelie landing (nose held high, down on the back
 * wheel) and a whip (the bike laid flat sideways in the air, straightened before the landing).
 * `land` events carry the one landed as `data.trick` ('' for none) and a flip's turns as
 * `data.flips`; `EntitySnapshot.trick` shows the one in progress. From the pitch deck's #13 ("Air
 * that pays"): `newspaper`, on the biggest jumps only, the rider sits back as if in a lawn chair
 * and reads the paper; let go in time it is a trick, and held into the ground the rider lands
 * holding the newspaper, a crash whose `data.attempt` is `newspaper`.
 */
export const TRICK_IDS = ['backflip', 'frontflip', 'wheelie', 'whip', 'newspaper'] as const;
export type TrickId = (typeof TRICK_IDS)[number];

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
  /**
   * This rider's signature move (interview, 2026-10-02: "Visible personalities"), from the rider
   * file's `personality.signature`. Absent: none.
   */
  signature?: SignatureId;
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
  /** His pursuit habit (run W-T, law with a personality). Absent: the plain cop, as before. */
  habit?: SimLawHabit | undefined;
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
  /**
   * The rider file's `stats.toughness` (playtest 2, "Visible personalities"): divides the damage
   * and the stagger this rider takes. Absent means 1; buildSimConfig always writes it.
   */
  toughness?: number;
  /**
   * The rider file's `stats.power`: multiplies the damage of every hit this rider lands. Absent
   * means 1; buildSimConfig always writes it.
   */
  power?: number;
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
   * `melee.wrap` or `taser.stun`, and from W-T `throw.burst`, `melee.yank` and `melee.sweep`; a
   * closed list in sim/combat (WEAPON_BEHAVIOURS). Absent or unknown is `melee.swing`.
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
   * Per-area road-vehicle weights (run W-R; interview, 2026-10-02: distinct keys), by area tag: the
   * weight this type has in each `traffic.areas` entry of the event's region. Where a road tag that
   * is an area (a key of any type's `areaWeights`) covers a vehicle's spawn spot, that area's
   * weights replace `weight`, and a type without the key gets 0 there. Absent: no area lists it.
   * buildSimConfig writes it only when the region has areas.
   */
  areaWeights?: Readonly<Record<string, number>>;
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
  /**
   * The grudge match's rival rule (run W-T, the pitch deck's #14: the event file's `rules.rule`)
   * and its rival's content id, or absent. Only `bad-connection` changes the sim (that rival's lag
   * move warns, drops and reconnects up the road, with `badConnection` events); the career scores
   * the others from the public events. Absent, every race runs as before, so no hash moves.
   */
  grudgeRule?: { rule: GrudgeRuleId; rival: string };
  /**
   * The career field's level for the rivals' fighting (playtest 3, round 1: "the field levels up
   * every tier"; round 3, "Gentle climb"): `aggressionScale` multiplies every rival's aggression on
   * top of the difficulty preset, and `signatureGapScale` each signature move's gap and spread
   * (below 1, more often). buildSimConfig writes it from the career's FieldLevel. Absent means 1 and
   * 1, and every race runs as before, so no hash moves.
   */
  level?: SimEventLevel;
}

/** SimEventDef.level: the career tier's scales on the rivals' fighting. */
export interface SimEventLevel {
  aggressionScale: number;
  signatureGapScale: number;
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
   * Playtest 2 (2026-10-02, "I think I've only ever encountered cops once"): a patrol on top of the
   * mix. Besides the starters, who leave the lot as before, the race sends 1 to `patrolMax` more
   * cops up the road: each waits on the shoulder where the field arrives early in the race, lights
   * up as a player comes near, and pulls out as he draws level (`patrolMax`; absent or 0: no patrol).
   */
  patrolMax?: number;
  /**
   * Playtest 2's heat meter (`heat`; absent or false: off): chaos raises the player's heat, the
   * tiers bring one more cop, then a pursuit pair, then a roadblock, and riding clean cools it.
   */
  heat?: boolean;
  /**
   * The END OF JURISDICTION sign (run W-T, law with a personality): its words, from the law crew of
   * the race's first cop (`jurisdiction.sign`). With the heat meter on, sim/cops puts it up beside
   * the road part-way along the route; a player crossing it has his heat cooled and the cops on
   * him pull over. Absent: no sign.
   */
  jurisdiction?: { label: string; agency: string };
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
  /**
   * Playtest 3's moves: a clean wheelie's cash per second (the sweet band's seconds whole, the rest
   * at half), and a drift's per second of full slip at full speed (sim/riders/drift.ts accrues it).
   * Absent means 0 (hand-built configs); buildSimConfig writes them from the event's rewards.
   */
  perWheelieSecondCash?: number;
  perDriftSecondCash?: number;
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
  /**
   * The event region's roadside smashables (run W-T, "the road fights back"): the region file's
   * live `smashables`, in file order. sim/smash places them beside the road from its own seeded
   * stream. Absent or empty: none. buildSimConfig always writes it.
   */
  smashables?: readonly SimSmashableDef[];
}

/** One kind of roadside smashable a region puts out (docs/content-packs.md, "Region"). */
export interface SimSmashableDef {
  /** The item's reference, `<packId>:region/<regionId>#<itemId>` (the veto format). */
  contentId: string;
  kind: SmashableKind;
  /** The takedown name ('CATCH OF THE DAY'). */
  name: string;
  /** How often it is picked against the region's others (1 when the file leaves it out). */
  weight: number;
  /** The road tags it stands on (any one); empty: any open road of the region. */
  tags: readonly string[];
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
