// The course's honest edges (the maintainer, 2026-10-06, [decided]: "consistent physics and gameplay is important
// here so players know what to expect and how to interact with the world"; the course has edges, crossing one is
// a quick reset with the time penalty, never an invisible wall; sim/riders/course.ts). On a straight fixture road
// whose bands and tags the test sets, the whole sim stepped by ticks:
// - on the ground, an edge with nothing drawn (soft ground, a bare hard edge with ground past it) holds nothing:
//   across its line the rider is out, `crash` `cause: 'over'`, `past: 'ground'`, the penalty at once and the
//   respawn on the road at the crossing; an edge where something is drawn (the ferns, a deck's edge over a drop)
//   still holds. Controls: the old rules (`riders.courseEdges` 0) hold him at the band's edge;
// - in the air, a soft edge or the ferns are cleared above what is drawn there, and coming down past them is out
//   the same way (the chalk mark is withheld); below the ferns' top he is held. Control: the old rules hold him at
//   the band's edge at any height (the invisible wall in the air);
// - race progress stays where he left the course until he is back on it.
import { describe, expect, it } from 'vitest';
import { quantizeInput } from '../api';
import { createSimWithWorld } from '../create';
import { OFF_ROAD_PARAM } from '../ground';
import { raceState } from '../race';
import type { SimConfig, SimEvent } from '../types';
import type { Mover, World } from '../world';
import {
  createRoadNetwork,
  createRouteProgress,
  fixtureNetwork,
  GROUND_EDGE_TOP_M,
  type BakedTag,
  type BakedVerge,
} from '../../road';
import { BIKE_HALF_WIDTH_M, riderState, touchdownOf } from './index';
import { STRAIGHT, testConfig } from './testing';
import { groundEdgeOpen } from './course';
import { gapBridge, gapFeature, gapSimConfig, GAP_DECK_Y } from '../tumble/gap-fixture';

/** The fixture's lanes end at d ±4.9. */
const LANE_EDGE = 4.9;
const OLD_RULES = { 'riders.courseEdges': 0 } as const;

const band = (widthM: number, surface: BakedVerge['surface'], edge: BakedVerge['edge']): BakedVerge => ({
  widthM,
  surface,
  edge,
});

/** The straight fixture, off-road on, with a given band on both sides or tags that derive one. */
function courseConfig(
  opts: { verge?: BakedVerge; tags?: readonly BakedTag[]; tuning?: Readonly<Record<string, number>> } = {},
): SimConfig {
  const bundle = fixtureNetwork(STRAIGHT);
  const roads = bundle.roads.map((r) => ({
    ...r,
    ...(opts.tags ? { tags: [...opts.tags] } : {}),
    laneSections: opts.verge
      ? r.laneSections.map((sec) => ({ ...sec, verges: { left: opts.verge, right: opts.verge } }))
      : r.laneSections,
  }));
  const road = createRoadNetwork({ network: bundle.network, roads });
  const route = createRouteProgress(road, {
    id: 'r',
    network: 'fixture',
    start: { road: 'a', s: 40, dir: 1 },
    finish: { road: 'a', s: 2980 },
    mainPath: ['a'],
    allowedRoads: ['a'],
    closed: false,
  });
  const base = testConfig({ tuning: { [OFF_ROAD_PARAM]: 1, ...opts.tuning } });
  return { ...base, road, route };
}

interface Run {
  world: World;
  me: Mover;
  events: SimEvent[];
  /** The furthest the rider's centre got toward +d while riding or flying, m. */
  maxD: number;
  /** Race progress each tick, m. */
  progress: number[];
}

/**
 * The whole sim, one player put at (s, d) at `speed` with heading `yaw` (in the air `hM` over the road with no
 * vertical speed, when given), steering right and holding the throttle for `ticks`.
 */
function run(
  config: SimConfig,
  at: { s: number; d: number; speed: number; yaw: number; hM?: number },
  ticks: number,
  until?: (events: readonly SimEvent[]) => boolean,
): Run {
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers.find((m) => m.kind === 'rider');
  if (!me) throw new Error('no rider');
  me.pos.s = at.s;
  me.pos.d = at.d;
  me.speed = at.speed;
  me.yaw = at.yaw;
  const st = riderState(world);
  st.yAbs[me.id] = config.road.surfaceHeight(0, at.s, at.d) + (at.hM ?? 0);
  if (at.hM !== undefined) {
    me.mode = 'Airborne';
    me.h = at.hM;
    st.vy[me.id] = 0;
    st.airTicks[me.id] = 0;
  }
  const events: SimEvent[] = [];
  const progress: number[] = [];
  let maxD = me.pos.d;
  for (let t = 0; t < ticks; t++) {
    sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 1, flags: 0 })]);
    events.push(...sim.events());
    if (me.mode === 'Road' || me.mode === 'Airborne') maxD = Math.max(maxD, me.pos.d);
    progress.push(raceState(world).progress[me.id] ?? NaN);
    if (until?.(events)) break;
  }
  return { world, me, events, maxD, progress };
}

const ofType = (evs: readonly SimEvent[], type: string) => evs.filter((e) => e.type === type);

describe('the course on the ground: an edge with nothing drawn holds nothing', () => {
  it('mangrove ground beyond a derived water edge is open ground, while open water still holds', () => {
    const tag = (tag: string): BakedTag => ({ tag, side: 'both', s0: 0, s1: 3000 });
    const land = courseConfig({ tags: [tag('mangrove')] });
    const water = courseConfig({ tags: [tag('water-open')] });
    expect(land.road.vergeAt(0, 100, 'right').edge).toBe('water');
    expect(groundEdgeOpen(land.road, 0, 100, 'right', 'water')).toBe(true);
    expect(groundEdgeOpen(water.road, 0, 100, 'right', 'water')).toBe(false);
  });
  const soft = band(8, 'sand', 'soft');
  const start = { s: 100, d: LANE_EDGE + 8 - 1.2, speed: 25, yaw: 0.45 };

  it('past a soft edge the rider is out: the quick reset with the penalty, and the respawn at the crossing', () => {
    const r = run(courseConfig({ verge: soft }), start, 400, (evs) => evs.some((e) => e.type === 'respawn'));
    const crash = ofType(r.events, 'crash');
    const splash = ofType(r.events, 'splash');
    const respawn = ofType(r.events, 'respawn');
    console.log(
      `[examined] 400 ticks into a soft edge: crash ${JSON.stringify(crash[0]?.data)}; splash ticks ${splash.map((e) => e.tick).join(',')}; respawn ${JSON.stringify(respawn[0]?.data)} at tick ${respawn[0]?.tick}; now ${r.me.mode} at s ${r.me.pos.s.toFixed(1)} d ${r.me.pos.d.toFixed(2)}`,
    );
    expect(crash).toHaveLength(1);
    expect(crash[0]?.data).toMatchObject({
      cause: 'over',
      overboard: true,
      past: 'ground',
      high: false,
      side: 1,
    });
    // Nothing held it at its riding limit (half a bike inside the edge): it rode on to the band's line.
    const line = LANE_EDGE + 8;
    expect(r.maxD).toBeGreaterThan(line - BIKE_HALF_WIDTH_M + 0.2);
    expect(r.maxD).toBeLessThanOrEqual(line);
    // Down at once (nothing to fall into): the penalty starts on the crash's tick, both bodies.
    expect(splash.map((e) => e.tick)).toEqual([crash[0]?.tick, crash[0]?.tick]);
    expect(splash.every((e) => e.data['past'] === 'ground' && e.data['high'] === false)).toBe(true);
    // The penalty (tumble.splashPenaltyS, 4 s), then back on the bike on the road at the crossing.
    expect(respawn).toHaveLength(1);
    expect((respawn[0]?.tick ?? 0) - (crash[0]?.tick ?? 0)).toBe(240);
    expect(respawn[0]?.data).toMatchObject({ reason: 'splash', past: 'ground' });
    const crossS = Number(crash[0]?.data['crossS']);
    expect(Number(crash[0]?.data['crossD'])).toBeCloseTo(line - BIKE_HALF_WIDTH_M, 6);
    // Woken on the bike, on the road where he left it (its own side's band, at the crossing).
    expect(r.me.mode).toBe('Road');
    expect(r.me.pos.s).toBeCloseTo(crossS, 6);
    expect(r.me.pos.d).toBeLessThanOrEqual(line - BIKE_HALF_WIDTH_M + 1e-9);
    // Race progress held at the crossing while he was out: no tick past it until he rides on from there.
    const at = r.progress[(crash[0]?.tick ?? 0) - 1] ?? NaN;
    const out = r.progress.slice(crash[0]?.tick ?? 0, respawn[0]?.tick ?? 0);
    expect(Math.max(...out)).toBeLessThanOrEqual(at + 1e-9);
  });

  it('control, the old rules: the soft edge holds him at the band, no event', () => {
    const r = run(courseConfig({ verge: soft, tuning: OLD_RULES }), start, 120);
    expect(r.events.filter((e) => e.type === 'crash' || e.type === 'wobble')).toEqual([]);
    expect(r.maxD).toBeLessThanOrEqual(LANE_EDGE + 8 - BIKE_HALF_WIDTH_M + 1e-9);
    expect(r.me.mode).toBe('Road');
  });

  it('an edge where something is drawn still holds: the ferns', () => {
    const r = run(
      courseConfig({ verge: band(6, 'dirt', 'brush') }),
      { ...start, d: LANE_EDGE + 6 - 1.2 },
      120,
    );
    expect(ofType(r.events, 'crash')).toEqual([]);
    expect(ofType(r.events, 'wobble').map((e) => e.data['cause'])).toEqual(['brush']);
    expect(r.maxD).toBeLessThanOrEqual(LANE_EDGE + 6 - BIKE_HALF_WIDTH_M + 1e-9);
  });

  it("a bare hard edge is open with ground past it, and holds where a deck's edge drops away", () => {
    // Tags that name no land: no band, a hard edge at the lanes (road/cross-section.ts deriveVerge).
    const ground = run(
      courseConfig({ tags: [{ s0: 0, s1: 3000, side: 'both', tag: 'not-land' }] }),
      {
        ...start,
        d: LANE_EDGE - 1.2,
      },
      60,
    );
    expect(ofType(ground.events, 'crash')[0]?.data).toMatchObject({ cause: 'over', past: 'ground' });
    const deck = run(
      courseConfig({ tags: [{ s0: 0, s1: 3000, side: 'both', tag: 'bridge' }] }),
      {
        ...start,
        d: LANE_EDGE - 1.2,
      },
      60,
    );
    expect(ofType(deck.events, 'crash').map((e) => e.data['cause'])).toEqual(['barrier']);
    expect(deck.maxD).toBeLessThanOrEqual(LANE_EDGE - BIKE_HALF_WIDTH_M + 1e-9);
  });
});

describe('the course in the air: cleared above what is drawn, out past it', () => {
  const soft = band(8, 'sand', 'soft');
  const brush = band(6, 'dirt', 'brush');
  const fly = (verge: BakedVerge, hM: number, tuning: Readonly<Record<string, number>> = {}) =>
    run(
      courseConfig({ verge, tuning }),
      { s: 100, d: LANE_EDGE + verge.widthM - 1.5, speed: 25, yaw: 0.45, hM },
      150,
    );

  it('over a soft edge 3 m up: on past it, and down out of bounds; control, the old rules hold him at any height', () => {
    const r = fly(soft, 3);
    const crash = ofType(r.events, 'crash')[0];
    console.log(
      `[examined] 3 m over a soft edge: furthest d ${r.maxD.toFixed(2)}, crash ${JSON.stringify(crash?.data)}`,
    );
    expect(r.maxD).toBeGreaterThan(LANE_EDGE + 8 + 2);
    expect(crash?.data).toMatchObject({ cause: 'over', past: 'ground', overboard: true });
    expect(ofType(r.events, 'land')).toEqual([]);
    const old = fly(soft, 3, OLD_RULES);
    console.log(
      `[examined] the old rules: furthest d ${old.maxD.toFixed(2)}, events ${old.events.map((e) => e.type).join(',')}`,
    );
    expect(old.maxD).toBeLessThanOrEqual(LANE_EDGE + 8 - BIKE_HALF_WIDTH_M + 1e-9);
    expect(ofType(old.events, 'crash')).toEqual([]);
  });

  it(`the ferns: held below their drawn top (${GROUND_EDGE_TOP_M.brush} m), out over them above it`, () => {
    const low = fly(brush, 0.6);
    expect(low.maxD).toBeLessThanOrEqual(LANE_EDGE + 6 - BIKE_HALF_WIDTH_M + 1e-9);
    expect(ofType(low.events, 'crash').filter((e) => e.data['cause'] === 'over')).toEqual([]);
    const high = fly(brush, 3);
    expect(high.maxD).toBeGreaterThan(LANE_EDGE + 6 + 2);
    expect(ofType(high.events, 'crash')[0]?.data).toMatchObject({ cause: 'over', past: 'ground' });
  });

  it('he wakes where he left the road, however far along he went off it (a run on the roofs gains nothing)', () => {
    // Over a soft edge 3 m up: the crossing is kept (`left`) while he is off the course. Carried 40 m on along
    // the road while still out there (as a run along the roofs would carry him), he comes down out of bounds:
    // the reset wakes him at the crossing, not 40 m on.
    const config = courseConfig({ verge: soft });
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider') as Mover;
    const st = riderState(world);
    me.pos.s = 100;
    me.pos.d = LANE_EDGE + 8 - 1.5;
    me.speed = 25;
    me.yaw = 0.45;
    me.mode = 'Airborne';
    st.yAbs[me.id] = config.road.surfaceHeight(0, 100, me.pos.d) + 3;
    st.vy[me.id] = 0;
    st.airTicks[me.id] = 0;
    const step = () => {
      sim.step([quantizeInput({ throttle: 1, brake: 0, steer: 1, flags: 0 })]);
      return sim.events();
    };
    let crossedAt = NaN;
    for (let t = 0; t < 30 && Number.isNaN(crossedAt); t++) {
      step();
      const left = st.left?.[me.id];
      if (left) crossedAt = left.s;
    }
    expect(crossedAt).toBeGreaterThan(100);
    // On along the road, still out past the edge and up in the air.
    me.pos.s += 40;
    st.yAbs[me.id] = config.road.surfaceHeight(0, me.pos.s, me.pos.d) + 2;
    const events: SimEvent[] = [];
    for (let t = 0; t < 400 && !events.some((e) => e.type === 'respawn'); t++) events.push(...step());
    const crash = events.find((e) => e.type === 'crash');
    console.log(
      `[examined] left the road at s ${crossedAt.toFixed(2)}, came down 40 m on: ${JSON.stringify(crash?.data)}`,
    );
    expect(crash?.data).toMatchObject({ cause: 'over', past: 'ground' });
    expect(Number(crash?.data['crossS'])).toBeCloseTo(crossedAt, 9);
    expect(me.mode).toBe('Road');
    expect(me.pos.s).toBeCloseTo(crossedAt, 9);
  });

  it('the chalk mark: none for a flight that comes down out of bounds, one for a flight that lands on the band', () => {
    const { world, config, me } = (() => {
      const config = courseConfig({ verge: soft });
      const { world } = createSimWithWorld(config);
      const me = world.movers.find((m) => m.kind === 'rider') as Mover;
      return { world, config, me };
    })();
    const st = riderState(world);
    me.mode = 'Airborne';
    me.pos.s = 100;
    me.speed = 25;
    st.vy[me.id] = 0;
    // Heading out over the soft edge, 3 m up: no landing to aim at.
    me.pos.d = LANE_EDGE + 8 - 1.5;
    me.yaw = 0.45;
    st.yAbs[me.id] = config.road.surfaceHeight(0, 100, me.pos.d) + 3;
    expect(touchdownOf(world, config, me)).toBeNull();
    // Straight along the road over the band: it lands there.
    me.yaw = 0;
    expect(touchdownOf(world, config, me)).not.toBeNull();
  });
});

describe('out past the edge of a hole in the road: the gap says where he wakes', () => {
  it('flying sideways out of a missing span, over its edge where no rail stands, he wakes past the gap', () => {
    // A bridge with a 60 m missing span (s 300 to 360): the rail stops at the hole, so over it nothing stands at
    // the edge. A rider 2 m over the hole flying out sideways crosses the edge's line there and falls past the
    // deck: out, as over any edge; his crossing is over the hole, where no road is, so the gap's rule wakes him.
    const config = gapSimConfig(gapBridge({ features: [gapFeature('hole', 300, 360)] }));
    const { sim, world } = createSimWithWorld(config);
    const me = world.movers.find((m) => m.kind === 'rider') as Mover;
    const st = riderState(world);
    me.pos.s = 320;
    me.pos.d = 3;
    me.speed = 20;
    me.yaw = 1;
    me.mode = 'Airborne';
    st.yAbs[me.id] = GAP_DECK_Y + 2;
    st.vy[me.id] = 0;
    st.airTicks[me.id] = 0;
    const events: SimEvent[] = [];
    for (let t = 0; t < 600 && !events.some((e) => e.type === 'respawn'); t++) {
      sim.step([quantizeInput({ throttle: 0, brake: 0, steer: 0, flags: 0 })]);
      events.push(...sim.events());
    }
    const crash = events.find((e) => e.type === 'crash');
    const back = events.find((e) => e.type === 'respawn');
    console.log(
      `[examined] out of the hole sideways: ${JSON.stringify(crash?.data)}; ${JSON.stringify(back?.data)}; woke at s ${me.pos.s.toFixed(1)} d ${me.pos.d.toFixed(2)}`,
    );
    expect(crash?.data).toMatchObject({ cause: 'over', overboard: true });
    expect(Number(crash?.data['crossS'])).toBeGreaterThan(300);
    expect(Number(crash?.data['crossS'])).toBeLessThan(360);
    expect(back?.data).toMatchObject({ reason: 'splash', gap: 'hole' });
    // On the deck past the hole, not over it.
    expect(me.mode).toBe('Road');
    expect(me.pos.s).toBeGreaterThan(360);
  });
});
