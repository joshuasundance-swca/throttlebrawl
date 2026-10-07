/// <reference types="vite/client" />
// What the snapshot says about a flight that leaves the road (the maintainer, 2026-10-06: "it would also
// be cool if when airborne it was possible to go over and across barriers"; "consistent physics and
// gameplay is important here so players know what to expect"; "include landing on big solid things
// beyond vehicles"). The sim already decides every outcome (sim/riders/gap.ts: over the barrier;
// supports.ts: land on and ride); this holds that what it tells the presentation agrees with it:
// - `floorY`, the surface straight below a rider in the air, is the road's deck while it is over it, and
//   past the edge the sea (Seven Mile's rail) or the drop's floor (Chuckanut's bluff), or the old
//   bridge's deck where another road lies under it;
// - `touchdown`, the chalk mark's forecast, meets the barrier by the sim's own rule (`overStep`): a flight
//   over the rail into the sea has no mark (no landing to aim at), one toward the old bridge has its
//   mark on that deck where the flight really lands, and one under the rail's top is held at the edge;
// - reading them writes nothing: two runs of the same inputs, one with a snapshot every tick, give the
//   same hashes, and the flight records and replays to the same snapshots.
// Real networks, one player alone (the ISOLATED profile, the ground beside the road on as the game has
// it), sim ticks only.
import { describe, expect, it } from 'vitest';
import {
  edgeTopAt,
  pastAt,
  waterLevelOf,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { createSimWithWorld } from '../../src/sim/create';
import { riderLimits, riderState } from '../../src/sim/riders';
import { gapSimConfig } from '../../src/sim/tumble/gap-fixture';
import type { EntitySnapshot, SimConfig, SimEvent, SimInput } from '../../src/sim/types';
import { ISOLATED } from './batch';

const print = (line: string) => process.stdout.write(`[flight-floor] ${line}\n`);

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

/** The real network and its route, one player on it, the ground beside the road on. */
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

/** One tick of a flight: the player's snapshot entity after it, and the tick's events. */
interface Frame {
  e: EntitySnapshot;
  events: SimEvent[];
  hash: number;
}

/**
 * Puts the player in the air at `at` (its centre at the riding limit on `side`) and steps the full sim
 * with the throttle open and the bars straight (or, `steerToSide`, held toward `side` in the air), up to `ticks` or
 * until `done`. With `look`, the snapshot is read every tick; without, never.
 */
function fly(
  config: SimConfig,
  at: Launch,
  ticks: number,
  look: boolean,
  done: (f: Frame) => boolean,
  steerToSide = false,
) {
  const road = config.road;
  const edge = road.edgeIndex(at.road);
  const { sim, world } = createSimWithWorld(config);
  const p = world.movers[0];
  if (!p) throw new Error('no player');
  const sign = at.side === 'right' ? 1 : -1;
  p.pos.edge = edge;
  p.pos.s = at.s;
  p.pos.dir = 1;
  const lim = riderLimits(world, config, edge, at.s, 0);
  p.pos.d = sign > 0 ? lim.hi - 0.05 : lim.lo + 0.05;
  const st = riderState(world);
  p.mode = 'Airborne';
  p.speed = at.speed;
  p.yaw = sign * at.yaw;
  st.yAbs[p.id] = road.surfaceHeight(edge, at.s, p.pos.d) + at.hM;
  st.vy[p.id] = at.vy;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const frames: Frame[] = [];
  const first = look ? sim.snapshot().entities[0] : undefined;
  if (first) frames.push({ e: first, events: [], hash: sim.hash() });
  const hashes: number[] = [];
  for (let t = 0; t < ticks; t++) {
    // The bars toward the side while in the air (the over-the-barrier suite's flight), or straight.
    const cmd: SimInput = {
      steer: steerToSide && p.mode === 'Airborne' ? sign * 127 : 0,
      throttle: 255,
      brake: 0,
      flags: 0,
    };
    sim.step([cmd]);
    hashes.push(sim.hash());
    if (!look) continue;
    const e = sim.snapshot().entities.find((x) => x.id === p.id);
    if (!e) throw new Error('no snapshot entity');
    const f = { e, events: [...sim.events()], hash: hashes[hashes.length - 1] ?? 0 };
    frames.push(f);
    if (done(f)) break;
  }
  return { frames, hashes, world, sim };
}

const landedOrDown = (f: Frame) => f.events.some((x) => x.type === 'land' || x.type === 'crash');
const SEVEN = configOf('osm-keys-seven-mile');
const CHUCKANUT = configOf('osm-pnw-chuckanut');
const GOLDEN_GATE = configOf('osm-sf-golden-gate');
const DUVAL = configOf('osm-keys-duval');

describe('over the Seven Mile Bridge’s rail into the sea', () => {
  const at: Launch = { road: 'osm-sm-bridge', s: 3000, side: 'left', hM: 3, vy: 1, speed: 30, yaw: 0.15 };

  it('the floor is the deck while it is over it, then the sea past the rail; there is no mark to aim at', () => {
    const f = fly(SEVEN, at, 60 * 3, true, () => false);
    const road = SEVEN.road;
    const deck = road.surfaceHeight(road.edgeIndex(at.road), at.s, 0);
    const air = f.frames.filter((x) => x.e.mode === 'Airborne');
    const first = air[0];
    print(
      `first airborne frame: floorY ${first?.e.floorY}, deck ${deck.toFixed(2)}, y ${first?.e.y.toFixed(2)}`,
    );
    // Over its own deck at the start: the deck.
    expect(first?.e.floorY).toBeCloseTo(deck, 6);
    // Out past the rail: the sea, below the deck, and under the rider the whole way down.
    const out = air.filter((x) => (x.e.floorY ?? deck) < deck - 1e-6);
    print(
      `${out.length} of ${air.length} airborne frames are past the rail; floors ${[...new Set(out.map((x) => x.e.floorY))].join(', ')}`,
    );
    expect(out.length).toBeGreaterThan(10);
    for (const x of out) {
      expect(x.e.floorY).toBe(waterLevelOf(road));
      expect(x.e.y).toBeGreaterThanOrEqual(x.e.floorY ?? 0);
    }
    // The chalk mark: a flight that ends in the sea has none (it is hidden once it is past the rail).
    expect(out.every((x) => x.e.touchdown === null || x.e.touchdown === undefined)).toBe(true);
  });

  it('control: under the rail’s top the rail holds it, the floor stays the deck and the mark is shown', () => {
    const f = fly(SEVEN, { ...at, hM: 0.6, vy: 0 }, 60 * 2, true, landedOrDown);
    const road = SEVEN.road;
    const deck = road.surfaceHeight(road.edgeIndex(at.road), at.s, 0);
    const air = f.frames.filter((x) => x.e.mode === 'Airborne');
    expect(air.length).toBeGreaterThan(3);
    for (const x of air) {
      expect(x.e.floorY).toBeGreaterThan(deck - 1);
      expect(x.e.touchdown).toBeTruthy();
    }
    // The mark lands inside the rail (its limit), on the deck.
    const td = air[1]?.e.touchdown;
    print(`held at the rail: mark y ${td?.y.toFixed(2)}, deck ${deck.toFixed(2)}`);
    expect(td?.y ?? NaN).toBeCloseTo(deck, 0);
  });
});

describe('over Chuckanut’s parapet, down the bluff', () => {
  it('the floor past the parapet is the drop’s floor (the water level), far below the deck', () => {
    const road = CHUCKANUT.road;
    const edge = road.edgeIndex('osm-chuckanut-cliffs');
    let s = 0;
    for (let k = 100; k < (road.edges[edge]?.length ?? 0); k += 10) {
      if (pastAt(road, edge, k, 'right') === 'drop' && edgeTopAt(road, edge, k, 'right') === 1.26) {
        s = k + 30;
        break;
      }
    }
    expect(s).toBeGreaterThan(0);
    const base: Launch = {
      road: 'osm-chuckanut-cliffs',
      s,
      side: 'right',
      hM: 3,
      vy: 1,
      speed: 25,
      yaw: 0.15,
    };
    const f = fly(CHUCKANUT, base, 60 * 4, true, () => false);
    const deck = road.surfaceHeight(edge, base.s, 0);
    const floors = f.frames.filter((x) => x.e.mode === 'Airborne').map((x) => x.e.floorY ?? NaN);
    print(`bluff at s ${base.s}: deck ${deck.toFixed(1)}, floors ${[...new Set(floors)].join(', ')}`);
    expect(Math.min(...floors)).toBe(waterLevelOf(road));
    expect(Math.min(...floors)).toBeLessThan(deck - 25);
  });
});

describe('toward the old Seven Mile Bridge beside the new one', () => {
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
  const near = closest();
  const at: Launch = {
    road: 'osm-sm-bridge',
    s: near.s - 60,
    side: 'right',
    hM: 4,
    vy: 6,
    speed: 38,
    yaw: 0.6,
  };

  it('the mark is on the old deck where the flight really lands, and the floor is that deck as it nears', () => {
    const f = fly(SEVEN, at, 60 * 6, true, landedOrDown, true);
    const last = f.frames[f.frames.length - 1];
    const land = f.frames.flatMap((x) => x.events).find((x) => x.type === 'land');
    const air = f.frames.filter((x) => x.e.mode === 'Airborne');
    // The mark forecast near take-off, and where the rider really came down (the snapshot after the land).
    // The forecast assumes the bars stay as they are, so judge it where the steering has done its work.
    const mark = air[air.length - 6]?.e.touchdown;
    print(
      `forecast ${JSON.stringify(mark)}; landed at (${last?.e.x.toFixed(1)}, ${last?.e.y.toFixed(2)}, ${last?.e.z.toFixed(1)}) on edge ${last?.e.road.edge}`,
    );
    expect(land).toBeDefined();
    expect(SEVEN.road.edges[last?.e.road.edge ?? -1]?.id.startsWith('osm-sm-old')).toBe(true);
    expect(mark).toBeTruthy();
    // Where the mark says and where it comes down agree to a few metres, on the same deck.
    const dx = (mark?.x ?? 0) - (last?.e.x ?? 0);
    const dz = (mark?.z ?? 0) - (last?.e.z ?? 0);
    print(
      `forecast off by ${Math.hypot(dx, dz).toFixed(2)} m, ${Math.abs((mark?.y ?? 0) - (last?.e.y ?? 0)).toFixed(2)} m high`,
    );
    expect(Math.hypot(dx, dz)).toBeLessThan(5);
    expect(Math.abs((mark?.y ?? 0) - (last?.e.y ?? 0))).toBeLessThan(0.8);
    // Just before the landing, the floor is the old deck's height (it has been handed over onto it).
    const handed = air.filter((x) => SEVEN.road.edges[x.e.road.edge]?.id.startsWith('osm-sm-old'));
    expect(handed.length).toBeGreaterThan(0);
    for (const x of handed) {
      expect(x.e.floorY).toBeCloseTo(SEVEN.road.surfaceHeight(x.e.road.edge, x.e.road.s, x.e.road.d), 6);
    }
  });

  it('control: a shorter flight that falls short of the old bridge ends in the sea, with no mark', () => {
    const f = fly(SEVEN, { ...at, speed: 14, vy: 1, hM: 3 }, 60 * 6, true, (x) =>
      x.events.some((e) => e.type === 'crash' || e.type === 'land'),
    );
    const air = f.frames.filter((x) => x.e.mode === 'Airborne');
    const past = air.filter((x) => (x.e.floorY ?? 0) <= 0.001);
    print(
      `short flight: ${air.length} airborne frames, ${past.length} over the sea; crash ${f.frames.flatMap((x) => x.events).find((e) => e.type === 'crash')?.data['cause']}`,
    );
    expect(past.length).toBeGreaterThan(0);
    expect(past.every((x) => !x.e.touchdown)).toBe(true);
  });
});

describe('a body falling overboard has the water for a floor', () => {
  const at: Launch = { road: 'osm-sf-gg-bridge', s: 1400, side: 'right', hM: 3, vy: 1, speed: 30, yaw: 0.15 };

  it('from the crash to the respawn the tumbling rider’s floor is the water level; riding again, it has none', () => {
    const f = fly(GOLDEN_GATE, at, 60 * 12, true, (x) => x.events.some((e) => e.type === 'respawn'));
    const down = f.frames.filter((x) => x.e.mode === 'Tumble');
    const sea = waterLevelOf(GOLDEN_GATE.road);
    print(
      `Golden Gate: ${down.length} tumbling frames, floors ${[...new Set(down.map((x) => x.e.floorY))].join(', ')}`,
    );
    expect(down.length).toBeGreaterThan(300);
    expect(down.every((x) => x.e.floorY === sea)).toBe(true);
    const last = f.frames[f.frames.length - 1];
    expect(last?.e.mode).toBe('Road');
    expect(last && 'floorY' in last.e).toBe(false);
  });

  it('control: an ordinary crash on the road (a tumble that goes over nothing) has no floor to read', () => {
    // Down hard and sideways on Duval Street, between its shopfronts: the tumble stays on the street.
    const street: Launch = {
      road: 'osm-duval-street',
      s: 200,
      side: 'right',
      hM: 2,
      vy: -14,
      speed: 12,
      yaw: 0.9,
    };
    const f = fly(DUVAL, street, 60 * 3, true, () => false);
    const down = f.frames.filter((x) => x.e.mode === 'Tumble');
    print(
      `on the street: ${down.length} tumbling frames, floors ${[...new Set(down.map((x) => x.e.floorY))].join(', ')}`,
    );
    expect(down.length).toBeGreaterThan(30);
    expect(down.every((x) => x.e.floorY === undefined)).toBe(true);
  });
});

describe('reading the snapshot writes nothing', () => {
  const at: Launch = { road: 'osm-sm-bridge', s: 3000, side: 'left', hM: 3, vy: 1, speed: 30, yaw: 0.15 };

  it('the same flight with a snapshot read every tick and with none hashes tick for tick the same', () => {
    const read = fly(SEVEN, at, 60 * 8, true, () => false);
    const blind = fly(SEVEN, at, 60 * 8, false, () => false);
    const n = Math.min(read.hashes.length, blind.hashes.length);
    expect(n).toBeGreaterThan(100);
    expect(read.hashes.slice(0, n)).toEqual(blind.hashes.slice(0, n));
  });

  it('the flight records and replays to the same snapshots (floor and mark included)', () => {
    const a = fly(SEVEN, at, 60 * 8, true, () => false);
    const b = fly(SEVEN, at, 60 * 8, true, () => false);
    expect(a.frames.map((x) => [x.e.floorY, x.e.touchdown ?? null, x.hash])).toEqual(
      b.frames.map((x) => [x.e.floorY, x.e.touchdown ?? null, x.hash]),
    );
  });
});
