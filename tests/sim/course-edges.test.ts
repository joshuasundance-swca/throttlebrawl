/// <reference types="vite/client" />
// The course's honest edges on the real roads (the maintainer, 2026-10-06, [decided]: a road race in a physical
// world with honest edges; "consistent physics and gameplay is important here so players know what to expect and how
// to interact with the world"; sim/riders/course.ts). One player on a real network, the world's systems off but the
// ground beside the road and the structures (ISOLATED with them on), the whole sim stepped by ticks; the structures
// are the race's plan for its seed (road/structures.ts, seeded):
// - out of bounds, one rule: into an alley between buildings on the ground, into it in the air below the roofs,
//   and down into the lot behind a block are each the quick reset (`crash` `cause: 'over'`, `past: 'ground'`), the
//   penalty, and the respawn on the road where he left it. Controls: the old rules (`riders.courseEdges` 0) hold him
//   at the band's edge, a wall at any height;
// - another road at a junction's mouth: across an open edge onto it he is handed onto it, no crash;
// - a corner cut over a block (the Mission's grid): his race progress stays where he left the road while he is off
//   it, and is taken where he rejoins: ahead it counts, behind it is no gain, and the lot behind gains nothing.
// The flights are found by a search over a few launch speeds, headings and heights, in a fixed order (the first
// that does what the test needs), each one deterministic.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import {
  createRouteProgress,
  raceStructures,
  structuresAt,
  type BakedNetwork,
  type BakedRoute,
  type StructurePlan,
} from '../../src/road';
import { quantizeInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { raceState } from '../../src/sim/race';
import { edgeHoldAt, offCourse, riderLimits, riderState } from '../../src/sim/riders';
import { courseSpotOf, roadPastLine } from '../../src/sim/riders/course';
import { plannedFrontAt } from '../../src/sim/riders/structures';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimEvent } from '../../src/sim/types';
import { createWorld, type Mover, type World } from '../../src/sim/world';
import { ISOLATED, NO_ROAD_EVENTS } from './batch';
import { print, routeNetworks, track } from './geometry-routes';

const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});
const packOf = (path: string) => /\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';

/** The course's honest edges with the structures and the supports they stand on; and the old rules. */
const EDGES = { 'ground.offRoad': 1, 'riders.structures': 1, 'riders.supports': 1, 'riders.courseEdges': 1 };
const OLD_RULES = { ...EDGES, 'riders.courseEdges': 0 };

/** The network's config: its first route, one player, ISOLATED with `rules`. */
function configOf(
  networkId: string,
  rules: Record<string, number>,
): { config: SimConfig; route: BakedRoute } {
  const net = routeNetworks().find((n) => n.id === networkId);
  if (!net) throw new Error(`no route network ${networkId}`);
  const network = Object.entries(networkFiles).find(
    ([p, n]) => n.id === net.id && packOf(p) === net.pack,
  )?.[1];
  const route = Object.entries(routeFiles).find(
    ([p, r]) => r.network === net.id && packOf(p) === net.pack,
  )?.[1];
  if (!network || !route) throw new Error(`no network or route ${networkId}`);
  const config = gapSimConfig(
    { network, roads: track(net).roads },
    { route, tuning: { ...ISOLATED, ...rules } },
  );
  return { config, route };
}

interface Launch {
  edge: number;
  s: number;
  d: number;
  dir: 1 | -1;
  speed: number;
  yaw: number;
  /** In the air this far over the road, rising at `vy`; on the ground when left out. */
  hM?: number;
  vy?: number;
  /** The bars held this way through the flight (-1 to 1; 0 when left out). */
  steer?: number;
}

interface Run {
  world: World;
  me: Mover;
  events: SimEvent[];
  /** By tick: race progress, whether he was off the course, his edge, and whether a structure stood under him. */
  progress: number[];
  off: boolean[];
  edges: number[];
  overBlock: number;
  /** Race progress as he set off. */
  p0: number;
  /** His mode after each tick. */
  modes: string[];
  /** The furthest his centre got past his band's line on `side` while on the launch edge, riding or flying, m. */
  furthestPast: number;
}

/** The whole sim from a launch: a tick riding where it starts (the race measures him there), then held inputs. */
function run(
  config: SimConfig,
  plan: StructurePlan | null,
  at: Launch,
  side: 1 | -1,
  ticks: number,
  stop?: (events: readonly SimEvent[], me: Mover, t: number, world: World) => boolean,
  steer = 0,
): Run {
  const { sim, world } = createSimWithWorld(config);
  const me = world.movers.find((m) => m.kind === 'rider');
  if (!me) throw new Error('no rider');
  const road = config.road;
  const st = riderState(world);
  me.pos = { edge: at.edge, s: at.s, d: at.d, dir: at.dir };
  me.speed = at.speed;
  me.yaw = 0;
  st.yAbs[me.id] = road.surfaceHeight(at.edge, at.s, at.d);
  const input = quantizeInput({ throttle: 0.5, brake: 0, steer: 0, flags: 0 });
  sim.step([input]);
  const p0 = raceState(world).progress[me.id] ?? NaN;
  me.pos = { edge: at.edge, s: at.s, d: at.d, dir: at.dir };
  me.speed = at.speed;
  me.yaw = at.yaw;
  st.yAbs[me.id] = road.surfaceHeight(at.edge, at.s, at.d);
  if (at.hM !== undefined) {
    me.mode = 'Airborne';
    me.h = at.hM;
    st.yAbs[me.id] = road.surfaceHeight(at.edge, at.s, at.d) + at.hM;
    st.vy[me.id] = at.vy ?? 0;
    st.airTicks[me.id] = 0;
  }
  const out: Run = {
    world,
    me,
    events: [],
    progress: [],
    off: [],
    edges: [],
    overBlock: 0,
    p0,
    modes: [],
    furthestPast: 0,
  };
  const held = quantizeInput({ throttle: 0.5, brake: 0, steer, flags: 0 });
  for (let t = 0; t < ticks; t++) {
    sim.step([held]);
    out.events.push(...sim.events());
    out.progress.push(raceState(world).progress[me.id] ?? NaN);
    const off = offCourse(world, config, me);
    out.off.push(off);
    out.edges.push(me.pos.edge);
    out.modes.push(me.mode);
    if (off && plan) {
      const w = road.toWorld(me.pos.edge, me.pos.s, me.pos.d, 0);
      if (structuresAt(plan, w.x, w.z).length > 0) out.overBlock++;
    }
    if ((me.mode === 'Road' || me.mode === 'Airborne') && me.pos.edge === at.edge) {
      const v = road.vergeAt(at.edge, me.pos.s, side > 0 ? 'right' : 'left');
      out.furthestPast = Math.max(out.furthestPast, (me.pos.d - v.dOuter) * side);
    }
    if (stop?.(out.events, me, t, world)) break;
  }
  return out;
}

const ofType = (evs: readonly SimEvent[], type: string) => evs.filter((e) => e.type === type);
const brief = (evs: readonly SimEvent[]) =>
  evs
    .filter((e) => ['land', 'crash', 'splash', 'respawn'].includes(e.type))
    .map((e) => `${e.tick}:${e.type}${JSON.stringify(e.data)}`)
    .join(' ');
const respawned = (evs: readonly SimEvent[]) => evs.some((e) => e.type === 'respawn');

/**
 * Race progress through each stretch off the course is the value it had the tick before he left: true when every
 * off tick holds it. Returns the ticks checked.
 */
function heldOffCourse(r: Run): { ticks: number; held: boolean } {
  let ticks = 0;
  let held = true;
  let before = r.p0;
  for (let t = 0; t < r.off.length; t++) {
    if (r.off[t]) {
      ticks++;
      if (r.progress[t] !== before) held = false;
    } else before = r.progress[t] ?? before;
  }
  return { ticks, held };
}

describe('out of bounds, one rule: into an alley, below the roofs (a planned front with a gap in it)', () => {
  // The first network with a gap in a row of planned buildings that opens on an alley or a lot: open at the
  // band's edge for 6 m along, and no structure in it for 12 m out.
  const found = (() => {
    for (const id of [
      'osm-keys-duval',
      'sf-mission',
      'sf-chinatown-northbeach',
      'sf-downtown',
      'sf-waterfront',
    ]) {
      const { config } = configOf(id, EDGES);
      const road = config.road;
      const world = createWorld(config);
      const plan = raceStructures(road, config.seed);
      for (const e of road.edges)
        for (const side of [1, -1] as const)
          for (let s = 20; s < e.length - 20; s += 1) {
            const vside = side > 0 ? 'right' : 'left';
            let open = true;
            for (let ds = -3; ds <= 3 && open; ds += 0.5) {
              const u = s + ds;
              open =
                plannedFrontAt(road, e.index, u, vside) &&
                edgeHoldAt(world, config, e.index, u, side).hold === 'open' &&
                !roadPastLine(config, e.index, u, side, 'hard');
            }
            if (!open) continue;
            const line = road.vergeAt(e.index, s, vside).dOuter;
            let clear = true;
            for (let ds = -3; ds <= 3 && clear; ds += 0.5)
              for (let dd = 0; dd <= 12 && clear; dd += 0.5) {
                const p = road.toWorld(e.index, s + ds, line + side * dd, 0);
                if (structuresAt(plan, p.x, p.z).length > 0) clear = false;
              }
            if (clear) return { id, config, at: { edge: e.index, s, side, line } };
          }
    }
    throw new Error('no opening in a planned front');
  })();
  const { config, at } = found;
  const old = configOf(found.id, OLD_RULES).config;
  const road = config.road;
  const start = (hM?: number): Launch => ({
    edge: at.edge,
    s: at.s,
    d: at.line - at.side * 1.2,
    dir: 1,
    speed: 6,
    yaw: at.side * 1,
    ...(hM !== undefined ? { hM } : {}),
  });

  it('on the ground: out across the line, the quick reset at the crossing; the old rules wall it', () => {
    const r = run(config, null, start(), at.side, 400, respawned);
    const crash = ofType(r.events, 'crash')[0];
    const back = ofType(r.events, 'respawn')[0];
    print(
      `${found.id} opening at ${road.edges[at.edge]?.id} s ${at.s} side ${at.side}: furthest past ${r.furthestPast.toFixed(2)}; ${brief(r.events)}; then ${r.me.mode} at s ${r.me.pos.s.toFixed(2)} d ${r.me.pos.d.toFixed(2)}`,
    );
    expect(crash?.data).toMatchObject({ cause: 'over', overboard: true, past: 'ground', high: false });
    expect(back?.data).toMatchObject({ reason: 'splash', past: 'ground' });
    expect(r.me.mode).toBe('Road');
    expect(r.me.pos.s).toBeCloseTo(Number(crash?.data['crossS']), 6);
    expect((r.me.pos.d - at.line) * at.side).toBeLessThan(0);
    const held = run(old, null, start(), at.side, 120);
    print(`old rules: furthest past ${held.furthestPast.toFixed(2)}; ${brief(held.events)}`);
    expect(held.furthestPast).toBeLessThanOrEqual(1e-9);
    expect(ofType(held.events, 'crash').filter((e) => e.data['cause'] === 'over')).toEqual([]);
  });

  it('in the air, 2 m up, below the roofs: out when he comes down; the old rules put him down at the edge', () => {
    const r = run(config, null, start(2), at.side, 400, respawned);
    print(`2 m up into the opening: furthest past ${r.furthestPast.toFixed(2)}; ${brief(r.events)}`);
    expect(r.furthestPast).toBeGreaterThan(0.5);
    expect(ofType(r.events, 'crash')[0]?.data).toMatchObject({ cause: 'over', past: 'ground' });
    expect(ofType(r.events, 'land')).toEqual([]);
    expect(respawned(r.events)).toBe(true);
    // The rule this replaces (the over-the-barrier lane's): ground past the edge came down at the band's edge,
    // landed there however far out he was.
    const held = run(old, null, start(2), at.side, 120);
    print(
      `old rules: furthest past ${held.furthestPast.toFixed(2)}; ${brief(held.events)}; ends at d ${held.me.pos.d.toFixed(2)}`,
    );
    expect(ofType(held.events, 'crash').filter((e) => e.data['cause'] === 'over')).toEqual([]);
    expect(ofType(held.events, 'land')).toHaveLength(1);
    expect((held.me.pos.d - at.line) * at.side).toBeLessThan(0);
  });
});

describe('another road at a junction: across the open edge he is handed onto it (keys-m1)', () => {
  it('rides off the band onto a sibling road with no crash, his edge now that road', () => {
    const { config } = configOf('keys-m1', EDGES);
    const road = config.road;
    const world = createWorld(config);
    // The first soft edge with a road the race allows, level with it, just past its line.
    let at: { edge: number; s: number; side: 1 | -1; other: number } | null = null;
    for (const e of road.edges) {
      for (let s = 10; s < e.length - 10 && !at; s += 2)
        for (const side of [1, -1] as const) {
          const h = edgeHoldAt(world, config, e.index, s, side);
          if (h.hold !== 'open' || h.kind !== 'soft') continue;
          const line = road.vergeAt(e.index, s, side > 0 ? 'right' : 'left').dOuter;
          const y = road.surfaceHeight(e.index, s, line);
          const spot = courseSpotOf(world, config, { edge: e.index, s, d: line + side * 0.6 }, y + 0.3);
          if (spot.kind === 'road' && spot.edge !== e.index && Math.abs(spot.y - y) < 0.1) {
            at = { edge: e.index, s, side, other: spot.edge };
            break;
          }
        }
      if (at) break;
    }
    if (!at) throw new Error('no junction mouth');
    const line = road.vergeAt(at.edge, at.s, at.side > 0 ? 'right' : 'left').dOuter;
    const r = run(
      config,
      null,
      { edge: at.edge, s: at.s, d: line - at.side * 0.8, dir: 1, speed: 10, yaw: at.side * 0.4 },
      at.side,
      40,
      (_e, me) => me.pos.edge !== at.edge,
    );
    print(
      `junction at ${road.edges[at.edge]?.id} s ${at.s} side ${at.side} onto ${road.edges[at.other]?.id}: now ${road.edges[r.me.pos.edge]?.id} ${r.me.mode}; ${brief(r.events)}`,
    );
    expect(ofType(r.events, 'crash')).toEqual([]);
    expect(r.me.mode).toBe('Road');
    expect(r.me.pos.edge).not.toBe(at.edge);
  });
});

describe('a corner cut over a block counts where he rejoins (sf-mission, the race seed’s plan)', () => {
  const { config, route } = configOf('sf-mission', EDGES);
  const road = config.road;
  const plan = raceStructures(road, config.seed);
  const progress = createRouteProgress(road, route);
  // The first corner of the route (its heading turns at least 45 degrees within 40 m either side of the join).
  const corner = (() => {
    const main = progress.mainEdges;
    for (let k = 0; k + 1 < main.length; k++) {
      const a = road.edges[main[k] ?? -1];
      const b = road.edges[main[k + 1] ?? -1];
      if (!a || !b) continue;
      const fa = road.frameAt(a.index, Math.max(0, a.length - 40));
      const fb = road.frameAt(b.index, Math.min(b.length, 40));
      const cross = fa.tx * fb.tz - fa.tz * fb.tx;
      const inside: 1 | -1 = cross > 0 ? 1 : -1;
      if (Math.abs(cross) > 0.7) return { a: a.index, b: b.index, inside };
    }
    throw new Error('no corner');
  })();
  /** Launches from the inside of the corner's first road, back `L` m from its end, over the block. */
  const flights = function* (from: number, back: boolean): Generator<Launch> {
    const e = road.edges[from];
    if (!e) return;
    for (const L of back ? [10, 20, 30] : [45, 60, 80])
      for (const yaw of [0.5, 0.8, 1.1])
        for (const speed of [18, 25])
          for (const hM of [9, 13, 18])
            for (const steer of [0, 1]) {
              const s = back ? L : e.length - L;
              const world = createWorld(config);
              const lim = riderLimits(world, config, from, s, 0);
              // Riding the route's way on the first road; back toward it, against the way, on the second.
              const dir: 1 | -1 = back ? -1 : 1;
              const inside = corner.inside;
              const d = inside > 0 ? lim.hi - 0.2 : lim.lo + 0.2;
              // A heading toward the inside: +yaw is toward the rider's right, which is -d riding against the way.
              yield {
                edge: from,
                s,
                d,
                dir,
                speed,
                yaw: inside * dir * yaw,
                hM,
                vy: 2,
                steer: inside * dir * steer,
              };
            }
  };
  const first = (
    from: number,
    back: boolean,
    wants: (r: Run) => boolean,
  ): { launch: Launch; r: Run; tried: number } => {
    let tried = 0;
    for (const launch of flights(from, back)) {
      tried++;
      const r = run(
        config,
        plan,
        launch,
        corner.inside,
        520,
        (evs, me, t, world) => {
          if (evs.some((e) => e.type === 'respawn')) return true;
          return t > 5 && me.mode === 'Road' && !offCourse(world, config, me);
        },
        launch.steer ?? 0,
      );
      if (wants(r)) return { launch, r, tried };
    }
    throw new Error(`no flight from ${road.edges[from]?.id} does it (${tried} tried)`);
  };

  it('ahead: off the road over the block, progress held where he left; on the next road ahead it counts', () => {
    const { launch, r, tried } = first(corner.a, false, (x) => {
      const end = x.edges[x.edges.length - 1];
      return (
        x.me.mode === 'Road' &&
        end === corner.b &&
        !offCourse(x.world, config, x.me) &&
        x.overBlock >= 3 &&
        ofType(x.events, 'crash').length === 0
      );
    });
    const held = heldOffCourse(r);
    const leave = r.progress[r.off.indexOf(true) - 1] ?? r.p0;
    const end = r.progress[r.progress.length - 1] ?? NaN;
    print(
      `corner ${road.edges[corner.a]?.id} -> ${road.edges[corner.b]?.id} (inside ${corner.inside}): flight ${JSON.stringify(launch)} (the ${tried}th tried); off the course ${held.ticks} ticks (over the block ${r.overBlock}), progress held ${held.held}; left at ${leave.toFixed(1)} m, rejoined at ${end.toFixed(1)} m on ${road.edges[r.me.pos.edge]?.id} s ${r.me.pos.s.toFixed(1)}; ${brief(r.events)}`,
    );
    expect(held.ticks).toBeGreaterThan(10);
    expect(held.held).toBe(true);
    // Rejoined ahead: his progress is the next road's where he came down, beyond where he left.
    expect(end).toBeCloseTo(progress.progressAt(corner.b, r.me.pos.s), 6);
    expect(end).toBeGreaterThan(leave);
  });

  it('behind: back over the block onto the road he came from, no gain', () => {
    const { launch, r, tried } = first(corner.b, true, (x) => {
      const end = x.edges[x.edges.length - 1];
      return (
        x.me.mode === 'Road' &&
        end === corner.a &&
        !offCourse(x.world, config, x.me) &&
        x.overBlock >= 3 &&
        ofType(x.events, 'crash').length === 0
      );
    });
    const held = heldOffCourse(r);
    const leave = r.progress[r.off.indexOf(true) - 1] ?? r.p0;
    const end = r.progress[r.progress.length - 1] ?? NaN;
    print(
      `back over the block: flight ${JSON.stringify(launch)} (the ${tried}th tried); off ${held.ticks} ticks, held ${held.held}; left at ${leave.toFixed(1)} m, rejoined at ${end.toFixed(1)} m; ${brief(r.events)}`,
    );
    expect(held.held).toBe(true);
    expect(end).toBeLessThan(leave);
  });

  it('down into the lot behind the block: the reset where he left the road, no gain', () => {
    const { launch, r, tried } = first(corner.a, false, (x) => {
      const crash = ofType(x.events, 'crash')[0];
      // Off the road from his flight to the crash, never back on a road between.
      const i0 = x.off.indexOf(true);
      const i1 = x.modes.indexOf('Tumble');
      return (
        crash?.data['cause'] === 'over' &&
        crash.data['past'] === 'ground' &&
        respawned(x.events) &&
        x.overBlock >= 3 &&
        i0 >= 0 &&
        i1 > i0 &&
        x.off.slice(i0, i1).every(Boolean)
      );
    });
    const crash = ofType(r.events, 'crash')[0];
    const leaveTick = r.off.indexOf(true);
    const leave = r.progress[leaveTick - 1] ?? r.p0;
    const end = r.progress[r.progress.length - 1] ?? NaN;
    print(
      `into the lot: flight ${JSON.stringify(launch)} (the ${tried}th tried); over the block ${r.overBlock} ticks; left at ${leave.toFixed(1)} m; crash ${JSON.stringify(crash?.data)}; woke at ${road.edges[r.me.pos.edge]?.id} s ${r.me.pos.s.toFixed(1)}, progress ${end.toFixed(1)} m`,
    );
    expect(heldOffCourse(r).held).toBe(true);
    // He wakes on the road where he left it: no further on than where he left.
    expect(r.me.mode).toBe('Road');
    expect(r.me.pos.edge).toBe(launch.edge);
    expect(end).toBeLessThanOrEqual(leave + 1);
  });
});

describe('a race where nobody leaves the course rides exactly as under the old rules', () => {
  // The base event's whole field (the rivals, traffic, the law), the player driven by the dev bot: with the
  // course's edges on and off, every mover the same every tick and the same events, and no state made for it
  // (the switch's own value in the tuning is the only difference in the world's hash).
  it.each([1, 2])(
    'seed %i, 30 s',
    (seed) => {
      const ride = (edges: number) => {
        const race = createHeadlessRace({ seed, tuning: { ...NO_ROAD_EVENTS, 'riders.courseEdges': edges } });
        const bot = createBot();
        const lines: string[] = [];
        let snap = race.sim.snapshot();
        let outs = 0;
        for (let t = 0; t < 60 * 30 && !race.sim.isOver(); t++) {
          const actions = emptyActions();
          bot.drive(snap, race.playerId, race.route, actions);
          race.sim.step([toSimInput(actions)]);
          snap = race.sim.snapshot();
          const events = race.sim.events();
          outs += events.filter((e) => e.type === 'crash' && e.data['cause'] === 'over').length;
          lines.push(
            `${t} ${snap.entities.map((e) => `${e.id}:${e.mode}:${e.road.edge}:${e.road.s}:${e.road.d}:${e.speed}`).join(' ')} | ${events.map((e) => `${e.type}:${e.actor}`).join(' ')}`,
          );
        }
        return { lines, outs, snap };
      };
      const on = ride(1);
      const off = ride(0);
      let first = -1;
      for (let i = 0; i < Math.max(on.lines.length, off.lines.length) && first < 0; i++)
        if (on.lines[i] !== off.lines[i]) first = i;
      print(
        `seed ${seed}: ${on.lines.length} ticks; out of bounds ${on.outs}; first difference at tick ${first}`,
      );
      expect(on.outs).toBe(0);
      expect(first).toBe(-1);
    },
    300_000,
  );
});
