// sim/tumble: the crash tumble, the rail and the splash, the get-up, the hand-back and the on-foot
// run-back (docs/architecture.md, "Crash tumble"; docs/milestones/M1.md, tumble-1;
// docs/milestones/M2.md, tumble-2).
//
// How a crash reaches this system: any system earlier in the tick order (controllers, riders,
// combat, cops, traffic, peds) emits a `crash` event whose `actor` is the rider who goes down.
// Optional numeric data: `sideMps` (a shove to the rider's right, m/s) and `upMps` (extra pop).
// The event's causeId is kept, so a kick → crash chain stays intact.
//
// The life of a crash, in scaled time (timers advance by timeScale each tick):
//   Tumble  a point-mass rig each for rider and bike (./rig.ts): a floppy ragdoll rider, and a
//           rigid bike that cartwheels end over end after a big impact. Contacts against the road,
//           the barrier line, and boxes built each tick from nearby traffic and riders
//           (./contacts.ts). A first contact with a car is a `crash` event (actor = the rider
//           already down, target = the car, data.contact `tumble`) and the car brakes; a first
//           contact with a riding rider wobbles them, or crashes them if it is hard enough (a new
//           `crash`, target = the rider whose body hit them). Every contact keeps the crash's
//           causeId. The mover keeps a valid road position: the rider cluster's projection, with h
//           above the surface.
//   Rail    a cluster whose centre crosses a `rail` higher than its heightM goes overboard
//           (`railOver`), falls to the water plane (world y = 0: `splash`), and after the splash
//           penalty the rider respawns at rest on the bike, on the bridge where it went over
//           (`respawn`, reason `splash`). No hand-back while a body is overboard; no swimming.
//   hand-back when every particle stays under `tumble.restMps` (1.5 m/s, nearly stopped) for 0.5 s,
//           or after `tumble.timeoutS` (3.5 s) (interview, 2026-10-02: "Trim only the waiting"; it
//           was 0.5 m/s and 5 s, so a slow last slide held the player for seconds): the bike is parked
//           at the nearest standing spot inside the drivable width, and the rider stands up
//           OnFoot (`getUp`). A rival someone knocked off (the crash's rider target, else whoever
//           landed a hit on them in the last 2 s) shakes a fist at them (`fistShake`), notes the
//           grudge (`grudgeNoted`) and starts the run-back after the get-up time. Everyone else
//           runs at once.
//   OnFoot  the rider runs to the bike in (s, d); the player steers sideways to dodge. Touching the
//           bike remounts. `skipRunBack` (player slots only) teleports to the bike and remounts
//           `tumble.skipDelayS` (3 s) after the press, or sooner: never later than running there
//           would have taken from where he stood (interview, 2026-10-02: "Skip is never slower than
//           running"); pressed during the tumble, it starts at the hand-back. The run is unchanged.
//   Road    remounted on the parked bike, rolling at `tumble.remountMps` (8 m/s, capped at the
//           bike's top speed; interview, 2026-10-02: "remount rolling"), with health restored to
//           full. The splash respawn on the bridge rolls the same way. Either way the rider is a
//           ghost to traffic for a moment (playtest 4; sim/traffic startTrafficGhost): back on the
//           bike behind stopped cars, it rides through them instead of crashing again.
//   Gap     (playtest 3; the maintainer, round 3: "the real 80 m missing span is the big jump (a miss
//           = splash, respawn on the highway)") a crash with `data.overboard` (sim/riders/gap.ts: a
//           rider past a gap's kill depth) starts with both bodies overboard (`railOver` with
//           `gap: true` for each, on the crash's tick), and a body that slides or falls into a gap
//           later goes overboard the same way (./rig.ts). The splash and its penalty are as for the
//           rail; the respawn is where the gap's `params.respawn` says (road/gap.ts): `far`, at rest
//           `respawnPastM` past its far end, or `main`, on the route's main road nearest the splash.
import type { EntityId, TuningParamDecl } from '../../core';
import type { Past, RoadPos } from '../../road';
import { systemState, type SimSystem, type World } from '../world';
import type { TumbleBody } from './body';
import type { Cluster } from './rig';
import { lateSteps } from '../late';

export { drivableBand, standingBand } from './body';
export type { TumbleBody } from './body';
export type { Cluster } from './rig';

export const TUMBLE_TUNING: readonly TuningParamDecl[] = [
  {
    id: 'tumble.restS',
    group: 'crash',
    label: 'Tumble rest time',
    default: 0.5,
    min: 0.1,
    max: 2,
    step: 0.05,
    unit: 's',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: the tumble hands back once nearly stopped. Was a fixed 0.5 m/s.
    id: 'tumble.restMps',
    group: 'crash',
    label: 'Tumble counts as stopped under',
    default: 1.5,
    min: 0.25,
    max: 4,
    step: 0.25,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: at most about 3.5 s of tumble (was 5).
    id: 'tumble.timeoutS',
    group: 'crash',
    label: 'Tumble timeout',
    default: 3.5,
    min: 1,
    max: 10,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.skipDelayS',
    group: 'crash',
    label: 'Skip run-back delay',
    default: 3,
    min: 0.5,
    max: 6,
    step: 0.25,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.runSpeedMps',
    group: 'crash',
    label: 'Run-back speed',
    default: 7,
    min: 3,
    max: 12,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    // Interview, 2026-10-02: "remount rolling". Was 0 (a standing start, about 9 s to speed).
    id: 'tumble.remountMps',
    group: 'crash',
    label: 'Remount rolling speed',
    default: 8,
    min: 0,
    max: 20,
    step: 0.5,
    unit: 'm/s',
    affectsSim: true,
  },
  {
    id: 'tumble.splashPenaltyS',
    group: 'crash',
    label: 'Splash penalty',
    default: 4,
    min: 1,
    max: 10,
    step: 0.5,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.getUpS',
    group: 'crash',
    label: 'Rival get-up and fist shake',
    default: 1.5,
    min: 0,
    max: 4,
    step: 0.1,
    unit: 's',
    affectsSim: true,
  },
  {
    id: 'tumble.contactCrashMps',
    group: 'crash',
    label: 'Flying body knocks a rider off at',
    default: 12,
    min: 4,
    max: 30,
    step: 1,
    unit: 'm/s',
    affectsSim: true,
  },
];
/**
 * An overboard body that has not reached the water after this long is put in it, and splashes (scaled
 * ticks). It is a safety, never the end of a real fall: 10 s is a free fall of 490 m from rest, over twice
 * the highest drop past any route's edge (the Gorge at Crown Point, 223 m; tests/sim/high-riders.test.ts
 * holds the two together). It used to be 3 s, which stopped any fall of more than about 44 m in mid-air
 * (the Golden Gate's bodies hung 38 m over the water, in view of the cut-away's held camera: the one live
 * check of 2026-10-07); and a body it ends goes into the water, never stopped where it is.
 */
export const OVERBOARD_MAX_TICKS = 600;

/** One rider's crash, from the crash tick to the remount (or the respawn). Plain data. */
export interface TumbleRecord {
  phase: 'tumble' | 'onFoot';
  crashTick: number;
  /** The crash event's causeId, for cause chains. */
  causeId: number;
  /** Tick of the hand-back, or -1 while tumbling. */
  handbackTick: number;
  /** Scaled ticks since the crash. */
  elapsed: number;
  /** Scaled ticks every particle has been at rest. */
  rest: number;
  /** The centres (and mean velocities) of the two clusters, for the snapshot and the hand-back. */
  rider: TumbleBody;
  bike: TumbleBody;
  /** The point-mass rigs. */
  riderRig: Cluster;
  bikeRig: Cluster;
  /** Spin of the rider's box about the vertical, rad/s (for the look only). */
  spin: number;
  /** Unit world direction the rider was travelling at the crash; decides dir after projection. */
  travelX: number;
  travelZ: number;
  /**
   * The rider's way along the route at the crash: 1 with it, -1 against it, 0 off the route. The
   * hand-back faces the same way along the route wherever the body comes to rest (playtest 2's
   * real-road hairpins could reverse the world-direction test). Absent in records from before it.
   */
  routeWay?: 1 | -1 | 0;
  /** Where the bike is parked after the hand-back, else null. */
  parked: RoadPos | null;
  /** Scaled ticks since a skip began, or -1. */
  skip: number;
  /** Scaled ticks the skip waits: the skip delay, or the run from where he stood if shorter. */
  skipTicks: number;
  /** A skip pressed during the tumble, to start at the hand-back. */
  skipQueued: boolean;
  /** Who knocked this rider off, or -1. */
  blame: EntityId;
  /** Entities the bodies have touched this crash (one contact event each). */
  touched: EntityId[];
  /** Where the first body went over a rail, else null: the respawn spot. */
  railAt: RoadPos | null;
  /**
   * The gap the first body went overboard through (playtest 3): its edge and feature id. Then the
   * gap's `params.respawn` decides the respawn spot, not `railAt`. Absent for every other crash, so
   * a race with no gap hashes as before.
   */
  gap?: { edge: number; id: string };
  /**
   * The first body went over the barrier line, or the rider flew over it (2026-10-06): what lies past
   * (`water` or `drop`), the drop's height (the deck at the crossing down to the water level, m) and
   * whether it is a high one (`riders.highDropM`). The `railOver`, `splash` and `respawn` events carry
   * them for the presentation (a high drop is a clean cut-away, a low one into water the splash).
   * Absent for every other crash, so a race where nobody goes over hashes as before.
   */
  over?: { past: Past; dropM: number; high: boolean };
  /** Scaled ticks since the first body went overboard, or -1. */
  overboard: number;
  /** Tick of the first splash, or -1, and scaled ticks since it (the penalty clock). */
  splashTick: number;
  splashElapsed: number;
  /** Scaled ticks of the get-up left before the run-back (rivals someone knocked off). */
  getUp: number;
  /** The get-up's full length, and whether the fist shake has happened. */
  getUpTotal: number;
  fistShaken: boolean;
}

export interface TumbleState {
  /** By entity id: the rider's crash in progress, or null. */
  records: (TumbleRecord | null)[];
  /** By entity id: the last rider to land a hit on them, and the tick (for blame). */
  hitBy: EntityId[];
  hitTick: number[];
  /**
   * By entity id: whose parked bike the rider rode into last tick, that rider's id + 1 (0 for none;
   * playtest 4, `parkedBikeContacts`), so one bike is ridden through once. Absent in old states.
   */
  bikeTouch?: number[];
}

export function tumbleState(world: World): TumbleState {
  return systemState<TumbleState>(world, 'tumble', () => ({
    records: [],
    hitBy: [],
    hitTick: [],
    bikeTouch: [],
  }));
}

/** The crash in progress for an entity, or null. */
export function tumbleRecord(world: World, id: EntityId): TumbleRecord | null {
  return tumbleState(world).records[id] ?? null;
}

/** Whether a rider is down: tumbling or on foot (the cop's bust reads this). */
export function isDown(world: World, id: EntityId): boolean {
  const m = world.movers[id];
  return m !== undefined && (m.mode === 'Tumble' || m.mode === 'OnFoot');
}

/** The parked bike of a rider on foot, or null. */
export function parkedBike(world: World, id: EntityId): RoadPos | null {
  return tumbleRecord(world, id)?.parked ?? null;
}

export const tumbleSystem: SimSystem = {
  name: 'tumble',
  init(world: World) {
    const st = tumbleState(world);
    for (const m of world.movers) {
      st.records[m.id] = null;
      st.hitBy[m.id] = -1;
      st.hitTick[m.id] = -1;
    }
  },
  // The step is in ./step.ts, a lazy chunk the race waits for (src/sim/late.ts).
  step: (world, config) => lateSteps().tumbleStep(world, config),
};
