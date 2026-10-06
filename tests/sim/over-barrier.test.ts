/// <reference types="vite/client" />
// Over the barrier (the maintainer, 2026-10-06, on the phone: "it would also be cool if when airborne
// it was possible to go over and across barriers, possibly resulting in a crash like falling in the
// water or whatever"; "consistent physics and gameplay is important here so players know what to
// expect and how to interact with the world"; high falls "(a)": the same physics everywhere, the
// Golden Gate included, a high drop shown as a clean cut-away with no gag).
//
// The rule these hold: a barrier holds a flying rider only below its top, and what lies beyond
// decides. Each case is one rider alone on the real road with the real systems (no field, no traffic:
// the ISOLATED profile, with the ground beside the road on as the game has it), put in the air beside
// the edge and driven by sim ticks only:
// - over the Seven Mile Bridge's 1.0 m rail at height: a low splash, the penalty, the respawn on the
//   bridge at the crossing; under it, held (the control);
// - off the new Seven Mile Bridge onto the old one beside it: a landing there, judged as any landing,
//   and no shortcut found;
// - over Chuckanut's parapet, down the bluff: a high drop, the same penalty and respawn;
// - over the Golden Gate's railing (a 1.3 m wall over the bay): a high drop, the same penalty and
//   respawn;
// - a building front (Duval Street's shopfronts) still holds a rider at any height;
// - the new behaviour records and replays to the same hashes, and a race where nobody goes over keeps
//   no new state.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, type ActionState } from '../../src/app';
import { createStubBot } from '../../src/dev/bot';
import {
  edgeTopAt,
  pastAt,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { quantizeInput } from '../../src/sim/api';
import { createSimWithWorld } from '../../src/sim/create';
import { aiSystem } from '../../src/sim/ai';
import { combatSystem } from '../../src/sim/combat';
import { copsSystem } from '../../src/sim/cops';
import { modifiersSystem } from '../../src/sim/modifiers';
import { pedsSystem } from '../../src/sim/peds';
import { raceSystem } from '../../src/sim/race';
import { riderLimits, riderState, ridersSystem } from '../../src/sim/riders';
import { trafficSystem } from '../../src/sim/traffic';
import { tumbleState, tumbleSystem } from '../../src/sim/tumble';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { SimConfig, SimEvent, SimInput } from '../../src/sim/types';
import { addMover, createWorld, orderSystems, stepWorld, worldHash, type World } from '../../src/sim/world';
import { ISOLATED } from './batch';

const print = (line: string) => process.stdout.write(`[over-barrier] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('/packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('/packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<BakedRoute>('/packs/*/regions/*/routes/*.json', {
  eager: true,
  import: 'default',
});

const SYSTEMS = orderSystems([
  aiSystem,
  ridersSystem,
  combatSystem,
  copsSystem,
  trafficSystem,
  pedsSystem,
  tumbleSystem,
  raceSystem,
  modifiersSystem,
]);

/** The real network and its route, one player on it, the world's systems off but the ground beside the road. */
function configOf(networkId: string): SimConfig {
  const network = Object.values(networkFiles).find((n) => n.id === networkId);
  if (!network) throw new Error(`no network ${networkId}`);
  const roads = network.roads.map((id) => {
    const r = Object.values(roadFiles).find((x) => x.id === id);
    if (!r) throw new Error(`no road ${id}`);
    return r;
  });
  const route = Object.values(routeFiles).find((r) => r.network === networkId);
  if (!route) throw new Error(`no route on ${networkId}`);
  const bundle: BakedNetworkBundle = { network, roads };
  return gapSimConfig(bundle, { route, tuning: { ...ISOLATED, 'ground.offRoad': 1 } });
}

interface Launch {
  road: string;
  s: number;
  side: 'left' | 'right';
  /** Height above the deck at the start, m, and the climb, m/s. */
  hM: number;
  vy: number;
  speed: number;
  /** The heading off the road, toward `side`, rad. */
  yaw: number;
}

interface Flight {
  world: World;
  config: SimConfig;
  events: (SimEvent & { at: number })[];
  /** The furthest the rider got past the edge's limit on its side, m (0 when it never left). */
  furthestPast: number;
  /** The road the rider was on at each tick. */
  roads: string[];
  inputs: SimInput[];
  /** The world's hash after each tick. */
  hashes: number[];
}

/**
 * Puts the player in the air at (road, s), its centre at the riding limit on `side`, `hM` above the
 * deck, heading out at `yaw`, and steps the world until `done` or `ticks`, holding the bars toward
 * `side` in the air and throttle open. `inputs`, when given, are replayed instead.
 */
function fly(
  config: SimConfig,
  at: Launch,
  ticks: number,
  done: (e: SimEvent[]) => boolean,
  inputs?: readonly SimInput[],
): Flight {
  const road = config.road;
  const edge = road.edgeIndex(at.road);
  const world = createWorld(config);
  const sideSign = at.side === 'right' ? 1 : -1;
  const p = addMover(world, 'rider', { edge, s: at.s, d: 0, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, config);
  const lim = riderLimits(world, config, edge, at.s, 0);
  p.pos.d = sideSign > 0 ? lim.hi - 0.05 : lim.lo + 0.05;
  const st = riderState(world);
  p.mode = 'Airborne';
  p.speed = at.speed;
  p.yaw = sideSign * at.yaw; // dd/dt = dir · v · sin(yaw), dir 1
  st.yAbs[p.id] = road.surfaceHeight(edge, at.s, p.pos.d) + at.hM;
  st.vy[p.id] = at.vy;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const events: (SimEvent & { at: number })[] = [];
  const roads: string[] = [];
  const used: SimInput[] = [];
  const hashes: number[] = [];
  let furthestPast = 0;
  for (let t = 0; t < ticks; t++) {
    const cmd = inputs?.[t] ?? {
      steer: p.mode === 'Airborne' ? sideSign * 127 : 0,
      throttle: 255,
      brake: 0,
      flags: 0,
    };
    used.push(cmd);
    const fresh = stepWorld(world, config, SYSTEMS, [cmd]);
    for (const e of fresh) events.push({ ...e, at: t });
    roads.push(road.edges[p.pos.edge]?.id ?? '');
    hashes.push(worldHash(world));
    if (p.pos.edge === edge && p.mode === 'Airborne') {
      const l = riderLimits(world, config, edge, p.pos.s, p.pos.d);
      furthestPast = Math.max(furthestPast, sideSign > 0 ? p.pos.d - l.hi : l.lo - p.pos.d);
    }
    if (done(fresh)) break;
  }
  return { world, config, events, furthestPast, roads, inputs: used, hashes };
}

const ofType = (f: Flight, type: SimEvent['type']) => f.events.filter((e) => e.type === type);
const overCrash = (f: Flight) => ofType(f, 'crash').find((e) => e.data['cause'] === 'over');
const respawned = (e: SimEvent[]) => e.some((x) => x.type === 'respawn');
/** Ticks from the first splash to the respawn: the penalty. */
const penaltyTicks = (f: Flight) =>
  (ofType(f, 'respawn')[0]?.at ?? NaN) - (ofType(f, 'splash')[0]?.at ?? NaN);
const brief = (f: Flight) =>
  f.events
    .filter((e) => ['crash', 'railOver', 'splash', 'respawn', 'land', 'wobble'].includes(e.type))
    .map((e) => `${e.at}:${e.type}${JSON.stringify(e.data)}`)
    .join(' ');

const SEVEN = configOf('osm-keys-seven-mile');
const CHUCKANUT = configOf('osm-pnw-chuckanut');
const GOLDEN_GATE = configOf('osm-sf-golden-gate');
const DUVAL = configOf('osm-keys-duval');
const SPLASH_PENALTY_TICKS = Math.round((SEVEN.tuning['tumble.splashPenaltyS'] ?? 4) * 60);

/** The respawn's spot on the road: where the player stands after it, and the crossing's s. */
function wokeAt(f: Flight): { road: string; s: number; d: number; inside: boolean; crossS: number } {
  const p = f.world.movers[0]!;
  const lim = riderLimits(f.world, f.config, p.pos.edge, p.pos.s, p.pos.d);
  const crash = overCrash(f);
  return {
    road: f.config.road.edges[p.pos.edge]?.id ?? '',
    s: p.pos.s,
    d: p.pos.d,
    inside: p.pos.d >= lim.lo - 1e-9 && p.pos.d <= lim.hi + 1e-9,
    crossS: typeof crash?.data['crossS'] === 'number' ? crash.data['crossS'] : NaN,
  };
}

describe('the Seven Mile Bridge: its 1.0 m rail over the water', () => {
  const at: Launch = { road: 'osm-sm-bridge', s: 3000, side: 'left', hM: 3, vy: 1, speed: 30, yaw: 0.15 };

  it('the road says it: a 1.0 m rail on both sides, the sea past it', () => {
    const e = SEVEN.road.edgeIndex(at.road);
    for (const side of ['left', 'right'] as const) {
      expect(edgeTopAt(SEVEN.road, e, at.s, side)).toBe(1);
      expect(pastAt(SEVEN.road, e, at.s, side)).toBe('water');
    }
  });

  it('above the rail it flies over: a low splash, the splash penalty, the respawn on the bridge at the crossing', () => {
    const f = fly(SEVEN, at, 60 * 12, respawned);
    const crash = overCrash(f);
    const splash = ofType(f, 'splash');
    const respawn = ofType(f, 'respawn')[0];
    const woke = wokeAt(f);
    print(`over the rail, 3 m up: furthest past ${f.furthestPast.toFixed(2)} m; ${brief(f)}`);
    print(
      `woke on ${woke.road} s ${woke.s.toFixed(1)} d ${woke.d.toFixed(2)} (crossed at s ${woke.crossS.toFixed(1)})`,
    );
    expect(f.furthestPast).toBeGreaterThan(0.5);
    expect(crash?.data).toMatchObject({ cause: 'over', overboard: true, past: 'water', high: false });
    expect(crash?.data['dropM']).toBeGreaterThan(0);
    expect(crash?.data['dropM']).toBeLessThan(25);
    expect(ofType(f, 'railOver').length).toBe(2);
    expect(splash[0]?.data).toMatchObject({ over: true, past: 'water', high: false });
    expect(respawn?.data).toMatchObject({ reason: 'splash', over: true, high: false });
    expect(penaltyTicks(f)).toBeGreaterThanOrEqual(SPLASH_PENALTY_TICKS - 1);
    expect(penaltyTicks(f)).toBeLessThanOrEqual(SPLASH_PENALTY_TICKS + 1);
    // Back on the bridge where it went over, inside its edges, riding.
    expect(woke.road).toBe(at.road);
    expect(Math.abs(woke.s - woke.crossS)).toBeLessThan(1);
    expect(woke.inside).toBe(true);
    expect(f.world.movers[0]?.mode).toBe('Road');
  });

  it('control: below the rail the rail holds it (no fall, no splash)', () => {
    const f = fly(SEVEN, { ...at, hM: 0.6, vy: 0 }, 120, () => false);
    print(`under the rail, 0.6 m up: furthest past ${f.furthestPast.toFixed(3)} m; ${brief(f)}`);
    expect(f.furthestPast).toBeLessThanOrEqual(1e-9);
    expect(overCrash(f)).toBeUndefined();
    expect(ofType(f, 'splash')).toEqual([]);
    expect(ofType(f, 'land').length).toBeGreaterThan(0);
  });
});

describe('the old Seven Mile Bridge beside the new one', () => {
  /** On the new bridge where the old one runs closest beside it on the right, and how far across. */
  function closest(): { s: number; gapM: number } {
    const road = SEVEN.road;
    const e = road.edgeIndex('osm-sm-bridge');
    const len = road.edges[e]?.length ?? 0;
    let best = { s: NaN, gapM: Infinity };
    for (let s = 200; s < len - 200; s += 50) {
      const v = road.vergeAt(e, s, 'right');
      for (let k = 0.5; k <= 40; k += 0.5) {
        const u = road.surfaceUnder({ edge: e, s, d: v.dOuter + k, dir: 1 }, 400, () => true);
        if (!u || !road.edges[u.edge]?.id.startsWith('osm-sm-old')) continue;
        if (k < best.gapM) best = { s, gapM: k };
        break;
      }
    }
    return best;
  }

  it('a flight over the rail toward it lands on it (judged as a landing there), and finds no shortcut', () => {
    const near = closest();
    print(`the old bridge runs closest at s ${near.s} of osm-sm-bridge, ${near.gapM} m past its rail`);
    expect(near.gapM).toBeLessThan(40);
    const f = fly(
      SEVEN,
      { road: 'osm-sm-bridge', s: near.s - 60, side: 'right', hM: 4, vy: 6, speed: 38, yaw: 0.6 },
      60 * 6,
      (e) => e.some((x) => x.type === 'land' || x.type === 'crash'),
    );
    const land = ofType(f, 'land')[0];
    const onRoad = (land ? f.roads[land.at] : undefined) ?? '';
    print(
      `toward the old bridge: furthest past ${f.furthestPast.toFixed(2)} m; landed on ${onRoad}; ${brief(f)}`,
    );
    expect(overCrash(f)).toBeUndefined();
    expect(ofType(f, 'splash')).toEqual([]);
    expect(land).toBeDefined();
    expect(onRoad.startsWith('osm-sm-old')).toBe(true);
    // Taken over inside the old deck's edges: no edge met on the way (no barrier wobble or crash).
    expect(f.events.filter((e) => e.data['cause'] === 'barrier')).toEqual([]);
    // Route progress stays a number on the old road (a branch of the route), and no find is stamped.
    const p = f.world.movers[0]!;
    expect(Number.isFinite(f.config.route.progressAt(p.pos.edge, p.pos.s))).toBe(true);
    expect(ofType(f, 'shortcutFound')).toEqual([]);
  });
});

describe('Chuckanut Drive: over the parapet, down the bluff', () => {
  /** An s on the cliffs where the bay side is the bluff's parapet. */
  function bluffS(): number {
    const road = CHUCKANUT.road;
    const e = road.edgeIndex('osm-chuckanut-cliffs');
    for (let s = 100; s < (road.edges[e]?.length ?? 0); s += 10) {
      if (pastAt(road, e, s, 'right') === 'drop' && edgeTopAt(road, e, s, 'right') === 1.26) return s + 30;
    }
    throw new Error('no bluff on the cliffs');
  }

  it('a high drop: the crash, the splash and the respawn say so; the penalty and the respawn are the same', () => {
    const s = bluffS();
    const f = fly(
      CHUCKANUT,
      { road: 'osm-chuckanut-cliffs', s, side: 'right', hM: 3, vy: 1, speed: 25, yaw: 0.15 },
      60 * 12,
      respawned,
    );
    const crash = overCrash(f);
    const woke = wokeAt(f);
    print(`over the parapet at s ${s}: ${brief(f)}; woke on ${woke.road} s ${woke.s.toFixed(1)}`);
    expect(crash?.data).toMatchObject({ cause: 'over', past: 'drop', high: true });
    expect(crash?.data['dropM']).toBeGreaterThan(25);
    expect(ofType(f, 'splash')[0]?.data).toMatchObject({ over: true, past: 'drop', high: true });
    expect(ofType(f, 'respawn')[0]?.data).toMatchObject({ reason: 'splash', high: true });
    expect(Math.abs(penaltyTicks(f) - SPLASH_PENALTY_TICKS)).toBeLessThanOrEqual(1);
    expect(woke.road).toBe('osm-chuckanut-cliffs');
    expect(woke.inside).toBe(true);
  });

  it('control: below the parapet it holds', () => {
    const f = fly(
      CHUCKANUT,
      { road: 'osm-chuckanut-cliffs', s: bluffS(), side: 'right', hM: 0.9, vy: 0, speed: 25, yaw: 0.15 },
      120,
      () => false,
    );
    print(`under the parapet: furthest past ${f.furthestPast.toFixed(3)}; ${brief(f)}`);
    expect(overCrash(f)).toBeUndefined();
    expect(f.furthestPast).toBeLessThanOrEqual(1e-9);
  });
});

describe('the Golden Gate: its 1.3 m railing, the same physics as everywhere (decided "(a)")', () => {
  const at: Launch = { road: 'osm-sf-gg-bridge', s: 1400, side: 'right', hM: 3, vy: 1, speed: 30, yaw: 0.15 };

  it('over the railing: a high drop, the same penalty, the respawn on the bridge at the crossing', () => {
    const e = GOLDEN_GATE.road.edgeIndex(at.road);
    expect(edgeTopAt(GOLDEN_GATE.road, e, at.s, 'right')).toBe(1.3);
    expect(pastAt(GOLDEN_GATE.road, e, at.s, 'right')).toBe('water');
    const f = fly(GOLDEN_GATE, at, 60 * 12, respawned);
    const crash = overCrash(f);
    const woke = wokeAt(f);
    print(`over the Golden Gate's railing: ${brief(f)}; woke on ${woke.road} s ${woke.s.toFixed(1)}`);
    expect(crash?.data).toMatchObject({ cause: 'over', past: 'water', high: true });
    expect(crash?.data['dropM']).toBeGreaterThan(25);
    expect(ofType(f, 'splash')[0]?.data).toMatchObject({ over: true, high: true });
    expect(Math.abs(penaltyTicks(f) - SPLASH_PENALTY_TICKS)).toBeLessThanOrEqual(1);
    expect(woke.road).toBe(at.road);
    expect(Math.abs(woke.s - woke.crossS)).toBeLessThan(1);
    expect(woke.inside).toBe(true);
  });

  it('control: below the railing it holds', () => {
    const f = fly(GOLDEN_GATE, { ...at, hM: 1, vy: 0 }, 120, () => false);
    expect(overCrash(f)).toBeUndefined();
    expect(f.furthestPast).toBeLessThanOrEqual(1e-9);
  });
});

describe('a building front stays a wall at any height (the one known gap: buildings are not in the sim)', () => {
  it("Duval Street's shopfronts hold a rider flying 8 m up", () => {
    const e = DUVAL.road.edgeIndex('osm-duval-street');
    expect(edgeTopAt(DUVAL.road, e, 200, 'right')).toBe(Infinity);
    const f = fly(
      DUVAL,
      { road: 'osm-duval-street', s: 200, side: 'right', hM: 8, vy: 0, speed: 20, yaw: 0.15 },
      150,
      () => false,
    );
    print(`Duval's shopfronts, 8 m up: furthest past ${f.furthestPast.toFixed(3)}; ${brief(f)}`);
    expect(overCrash(f)).toBeUndefined();
    expect(f.furthestPast).toBeLessThanOrEqual(1e-9);
  });
});

describe('determinism', () => {
  it('a flight over the rail and onto the old bridge records and replays to the same hash every tick', () => {
    for (const at of [
      { road: 'osm-sm-bridge', s: 3000, side: 'left', hM: 3, vy: 1, speed: 30, yaw: 0.15 },
      { road: 'osm-sm-bridge', s: 9500, side: 'right', hM: 4, vy: 6, speed: 38, yaw: 0.6 },
    ] as const) {
      const first = fly(SEVEN, at, 60 * 10, respawned);
      const replay = fly(SEVEN, at, first.inputs.length, () => false, first.inputs);
      const key = (f: Flight) => f.events.map((e) => `${e.at}:${e.type}:${JSON.stringify(e.data)}`);
      print(
        `${at.side} at s ${at.s}: ${first.inputs.length} ticks recorded, ${first.events.length} events; hashes match: ${first.hashes.every((h, i) => h === replay.hashes[i])}`,
      );
      expect(first.events.some((e) => e.type === 'crash' || e.type === 'land')).toBe(true);
      expect(replay.hashes).toEqual(first.hashes);
      expect(key(replay)).toEqual(key(first));
    }
  });

  it('a race where nobody goes over keeps no new state (so it hashes as before)', () => {
    const race = createHeadlessRace({ seed: 7 });
    const { sim, world } = createSimWithWorld(race.config);
    const bot = createStubBot();
    const events: SimEvent[] = [];
    let tumbles = 0;
    for (let t = 0; t < 1800 && !sim.isOver(); t++) {
      const me = sim.snapshot().entities[race.playerId];
      if (!me) throw new Error('no player');
      const a: ActionState = {
        throttle: 0,
        brake: 0,
        steer: 0,
        attack: false,
        attackSide: 0,
        kick: false,
        lookBack: false,
        skipRunBack: false,
      };
      bot.drive(me, race.route, a);
      sim.step([quantizeInput({ ...a, flags: 0 })]);
      events.push(...sim.events());
      for (const r of tumbleState(world).records) {
        if (!r) continue;
        tumbles++;
        expect('over' in r).toBe(false);
      }
    }
    const overs = events.filter((e) => e.type === 'crash' && e.data['cause'] === 'over');
    const keys = Object.keys(riderState(world));
    print(
      `seed 7, ${world.tick} ticks, ${events.length} events, ${tumbles} tumble-ticks, ${overs.length} over the barrier`,
    );
    expect(overs).toEqual([]);
    expect(keys).not.toContain('over');
    expect(keys).not.toContain('hop');
  });

  it('the control for that check: a flight over the rail does write it', () => {
    const f = fly(
      SEVEN,
      { road: 'osm-sm-bridge', s: 3000, side: 'left', hM: 3, vy: 1, speed: 30, yaw: 0.15 },
      30,
      () => false,
    );
    expect(Object.keys(riderState(f.world))).toContain('over');
  });
});
