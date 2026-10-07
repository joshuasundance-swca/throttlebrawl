/// <reference types="vite/client" />
// Over Chuckanut's parapet with the course's honest edges (the maintainer, 2026-10-06, [decided]: what is drawn is
// what is met; leaving the course is a quick reset with the time penalty, a low splash keeps its gag and a high
// drop is a clean cut-away). The one live check of 2026-10-07 (seed 1, tick 7410) saw a flight over the bluff's
// parapet at s 403 of the cliffs road crash as a 70 m drop to the sea, its bodies sinking into the grassy shelf the
// scene draws there at the road's height. Past the parapet the scene draws 6.6 m of that shelf, then the cliff
// (tests/sim/beyond-drawn.test.ts holds the sim's floor to the drawn scene everywhere). One rider alone on the real
// road, the world's systems off but the ground beside the road and the honest edges (ISOLATED with them on), put in
// the air beside the parapet and driven by sim ticks only:
// - a short flight over the parapet comes down on the shelf: out of bounds onto ground, the quick reset (`crash`
//   `cause: 'over'`, `past: 'ground'`, no drop, not high), the bodies where he came down at the shelf's height,
//   never under it, and the respawn on the road where he left it;
// - a long flight clears the shelf: past its lip the cliff's high drop to the sea, as before;
// - the control: the old rules (`riders.courseEdges` 0) read only the tags, and the same short flight is the 70 m
//   drop the live check saw;
// - the new behaviour records and replays to the same hash every tick.
import { describe, expect, it } from 'vitest';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road';
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

const print = (line: string) => process.stdout.write(`[beyond-flight] ${line}\n`);

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

/** Chuckanut Drive, one player, the world's systems off but the ground beside the road; the honest edges on or off. */
function chuckanut(honest: boolean): SimConfig {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-chuckanut');
  if (!network) throw new Error('no Chuckanut');
  const roads = network.roads.map((id) => {
    const r = Object.values(roadFiles).find((x) => x.id === id);
    if (!r) throw new Error(`no road ${id}`);
    return r;
  });
  const route = Object.values(routeFiles).find((r) => r.network === network.id);
  if (!route) throw new Error('no route on Chuckanut');
  return gapSimConfig(
    { network, roads },
    { route, tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': honest ? 1 : 0 } },
  );
}

/** The live check's crossing: the cliffs road at s 403, the bay side, where the parapet stands over the shelf. */
const ROAD = 'osm-chuckanut-cliffs';
const S = 403;

interface Launch {
  /** Height above the deck at the start, m, the climb, m/s, the speed, m/s, and the heading out, rad. */
  hM: number;
  vy: number;
  speed: number;
  yaw: number;
}

interface Flight {
  world: World;
  config: SimConfig;
  events: (SimEvent & { at: number })[];
  inputs: SimInput[];
  hashes: number[];
  /** Each body's height at each tick of the tumble, over the deck at the crossing, m (the lowest seen). */
  lowestBodyOverDeck: number;
  deckY: number;
}

/** The player in the air at the parapet's limit, `hM` up, heading out to the right; stepped until `done` or `ticks`. */
function fly(config: SimConfig, at: Launch, ticks: number, inputs?: readonly SimInput[]): Flight {
  const road = config.road;
  const edge = road.edgeIndex(ROAD);
  const world = createWorld(config);
  const p = addMover(world, 'rider', { edge, s: S, d: 0, dir: 1 }, 0);
  for (const sys of SYSTEMS) sys.init(world, config);
  const lim = riderLimits(world, config, edge, S, 0);
  p.pos.d = lim.hi - 0.05;
  const st = riderState(world);
  p.mode = 'Airborne';
  p.speed = at.speed;
  p.yaw = at.yaw;
  const deckY = road.surfaceHeight(edge, S, road.vergeAt(edge, S, 'right').dOuter);
  st.yAbs[p.id] = road.surfaceHeight(edge, S, p.pos.d) + at.hM;
  st.vy[p.id] = at.vy;
  st.airTicks[p.id] = 0;
  st.lastTick[p.id] = -1;
  const events: (SimEvent & { at: number })[] = [];
  const used: SimInput[] = [];
  const hashes: number[] = [];
  let lowest = Infinity;
  for (let t = 0; t < ticks; t++) {
    const cmd = inputs?.[t] ?? { steer: p.mode === 'Airborne' ? 127 : 0, throttle: 255, brake: 0, flags: 0 };
    used.push(cmd);
    const fresh = stepWorld(world, config, SYSTEMS, [cmd]);
    for (const e of fresh) events.push({ ...e, at: t });
    hashes.push(worldHash(world));
    const r = tumbleState(world).records[p.id];
    if (r && (p.mode as string) === 'Tumble')
      for (const c of [r.riderRig, r.bikeRig]) for (const q of c.p) lowest = Math.min(lowest, q.y - deckY);
    if (fresh.some((e) => e.type === 'respawn')) break;
  }
  return { world, config, events, inputs: used, hashes, lowestBodyOverDeck: lowest, deckY };
}

const ofType = (f: Flight, type: SimEvent['type']) => f.events.filter((e) => e.type === type);
const overCrash = (f: Flight) => ofType(f, 'crash').find((e) => e.data['cause'] === 'over');
const brief = (f: Flight) =>
  f.events
    .filter((e) => ['crash', 'railOver', 'splash', 'respawn', 'land'].includes(e.type))
    .map((e) => `${e.at}:${e.type}${JSON.stringify(e.data)}`)
    .join(' ');

/** A short flight over the parapet: about 4 m out when it comes down, on the 6.6 m shelf. */
const SHORT: Launch = { hM: 3, vy: 1, speed: 25, yaw: 0.15 };
/** A long one: about 14 m out before it is down to the road's height, past the shelf's lip. */
const LONG: Launch = { hM: 4, vy: 5, speed: 32, yaw: 0.5 };

describe("over Chuckanut's parapet with the honest edges: the shelf is ground, the cliff past it a drop", () => {
  it('a short flight comes down on the shelf: the quick reset at the road height, the bodies on the grass, the respawn', () => {
    const f = fly(chuckanut(true), SHORT, 60 * 12);
    const crash = overCrash(f);
    print(`short: lowest body ${f.lowestBodyOverDeck.toFixed(2)} m over the deck; ${brief(f)}`);
    expect(crash?.data).toMatchObject({ cause: 'over', overboard: true, past: 'ground', high: false });
    expect(crash?.data['dropM']).toBeLessThan(1);
    // The bodies stop where he came down, on the grass: never below the shelf drawn at the road's height (-0.09 m).
    expect(f.lowestBodyOverDeck).toBeGreaterThan(-0.6);
    // The same quick reset: the penalty, then the respawn on the road at the crossing, in his lane.
    const respawn = ofType(f, 'respawn')[0];
    expect(respawn).toBeDefined();
    const p = f.world.movers[0]!;
    expect(f.config.road.edges[p.pos.edge]?.id).toBe(ROAD);
    expect(Math.abs(p.pos.s - (crash?.data['crossS'] as number))).toBeLessThan(1);
    expect(p.mode).toBe('Road');
  });

  it('a long flight clears the shelf: past its lip the cliff, the high drop to the sea', () => {
    const f = fly(chuckanut(true), LONG, 60 * 14);
    const crash = overCrash(f);
    print(`long: ${brief(f)}`);
    expect(crash?.data).toMatchObject({ cause: 'over', overboard: true, past: 'drop', high: true });
    expect(crash?.data['dropM']).toBeGreaterThan(60);
    expect(ofType(f, 'respawn')[0]).toBeDefined();
  });

  it('control: the old rules read only the tags, and the same short flight is the 70 m drop the live check saw', () => {
    const f = fly(chuckanut(false), SHORT, 60 * 12);
    const crash = overCrash(f);
    print(`short, old rules: lowest body ${f.lowestBodyOverDeck.toFixed(2)} m over the deck; ${brief(f)}`);
    expect(crash?.data).toMatchObject({ cause: 'over', past: 'drop', high: true });
    expect(crash?.data['dropM']).toBeGreaterThan(60);
    // Its bodies fall through the drawn shelf (the defect, under the old rules).
    expect(f.lowestBodyOverDeck).toBeLessThan(-10);
  });

  it('records and replays to the same hash every tick (the shelf and the cliff)', () => {
    for (const at of [SHORT, LONG]) {
      const a = fly(chuckanut(true), at, 60 * 14);
      const b = fly(chuckanut(true), at, 60 * 14, a.inputs);
      expect(b.hashes).toEqual(a.hashes);
      expect(a.hashes.length).toBeGreaterThan(60);
    }
  });
});
