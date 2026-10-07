// A missed gap in the tumble (playtest 3, T3.1; the maintainer, round 3: "the real 80 m missing span
// is the big jump (a miss = splash, respawn on the highway)"; the critic's C1: in-line gaps wake the
// rider on the far side, `params.respawn: 'main'` on the route's main road). The riding side (the
// fall and the kill depth) is in sim/riders/gap.test.ts.
//
// Every test runs the real systems in the real tick order by sim ticks; a scripted injector stands
// in for combat where a test needs a crash at a set tick (as tumble2.test.ts does).
import { describe, expect, it } from 'vitest';
import {
  compileTrack,
  fixtureBranchTrack,
  gapAt,
  GAP_DEFAULTS,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from '../../road';
import { aiSystem } from '../ai';
import { copsSystem } from '../cops';
import { modifiersSystem } from '../modifiers';
import { pedsSystem } from '../peds';
import { raceSystem } from '../race';
import { riderState, ridersSystem } from '../riders';
import { trafficSystem } from '../traffic';
import type { SimConfig, SimEvent, SimEventType, SimInput } from '../types';
import {
  addMover,
  createWorld,
  emit,
  orderSystems,
  stepWorld,
  worldHash,
  type Mover,
  type SimSystem,
  type World,
} from '../world';
import { ownSideBand } from './body';
import { gapBridge, gapFeature, gapSimConfig, GAP_DECK_Y } from './gap-fixture';
import { tumbleRecord, tumbleState, tumbleSystem, TUMBLE_TUNING } from '.';

const PENALTY = Math.round((TUMBLE_TUNING.find((d) => d.id === 'tumble.splashPenaltyS')?.default ?? 0) * 60);
const REMOUNT = TUMBLE_TUNING.find((d) => d.id === 'tumble.remountMps')?.default ?? 0;

interface Harness {
  world: World;
  config: SimConfig;
  player: Mover;
  events: SimEvent[];
  step(input?: SimInput): SimEvent[];
}

/** The real systems, a crash injector in combat's slot, and the player placed where asked. */
function harness(
  config: SimConfig,
  at: { edge?: number; s: number; d: number; speed: number },
  crashAt: { tick: number; data?: Record<string, number | string | boolean> } | null = null,
): Harness {
  const world = createWorld(config);
  const player = addMover(world, 'rider', { edge: at.edge ?? 0, s: at.s, d: at.d, dir: 1 }, 0);
  const injector: SimSystem = {
    name: 'combat',
    init() {},
    step(w: World) {
      if (crashAt && w.tick === crashAt.tick) emit(w, 'crash', player.id, crashAt.data ?? {});
    },
  };
  const systems = orderSystems([
    aiSystem,
    ridersSystem,
    injector,
    copsSystem,
    trafficSystem,
    pedsSystem,
    tumbleSystem,
    raceSystem,
    modifiersSystem,
  ]);
  for (const s of systems) s.init(world, config);
  player.speed = at.speed;
  const events: SimEvent[] = [];
  return {
    world,
    config,
    player,
    events,
    step(input: SimInput = { steer: 0, throttle: 255, brake: 0, flags: 0 }) {
      const out = stepWorld(world, config, systems, [input]);
      events.push(...out);
      return out;
    },
  };
}

function until(h: Harness, done: () => boolean, max = 1500): void {
  for (let t = 0; !done(); t++) {
    if (t >= max) throw new Error(`condition not reached in ${max} ticks`);
    h.step();
  }
}

const ofType = (h: Harness, type: SimEventType) => h.events.filter((e) => e.type === type);

/** The Moser-style set piece: a 2.0 m / 16 m kicker with its lip at s 400, then a 64 m gap. */
const moser = (params?: Record<string, unknown>) =>
  gapBridge({
    kicker: { lipS: 400, heightM: 2, lengthM: 16 },
    features: [gapFeature('moser', 400, 464, params)],
  });

describe('a missed gap: overboard, the splash, and the far side', () => {
  it('goes overboard at once, splashes, and wakes 10 m past the gap after the splash penalty', () => {
    const h = harness(gapSimConfig(moser()), { s: 300, d: 1.7, speed: 25 });
    until(h, () => ofType(h, 'respawn').length > 0);
    const crash = ofType(h, 'crash')[0];
    const rails = ofType(h, 'railOver');
    const splashes = ofType(h, 'splash');
    const respawn = ofType(h, 'respawn')[0];
    console.log(
      `[examined] crash ${JSON.stringify(crash?.data)} @${crash?.tick}; railOver ${rails.map((e) => `${String(e.data['body'])}@${e.tick}`).join(',')}; splash ${splashes.map((e) => `${String(e.data['body'])}@${e.tick}`).join(',')}; respawn ${JSON.stringify(respawn?.data)} @${respawn?.tick} at s ${h.player.pos.s.toFixed(2)} d ${h.player.pos.d.toFixed(2)}`,
    );
    expect(crash?.data).toMatchObject({ cause: 'gap', overboard: true });
    // Both bodies go over on the crash's own tick, flagged as a gap (render's burst, no rail).
    expect(rails.map((e) => e.data['body']).sort()).toEqual(['bike', 'rider']);
    for (const e of rails) {
      expect(e.data['gap']).toBe(true);
      expect(e.tick).toBe(crash?.tick);
    }
    expect(ofType(h, 'getUp')).toHaveLength(0);
    const first = splashes[0];
    if (!first || !respawn) throw new Error('no splash or respawn');
    expect(respawn.tick - first.tick).toBe(PENALTY);
    expect(respawn.data).toMatchObject({ reason: 'splash', gap: 'moser', at: 'far' });
    // At rest past the far end, on its own side, rolling at the remount speed, health full.
    expect(h.player.mode).toBe('Road');
    expect(h.player.pos.edge).toBe(0);
    expect(h.player.pos.s).toBeCloseTo(464 + GAP_DEFAULTS.respawnPastM, 6);
    expect(h.player.pos.dir).toBe(1);
    const band = ownSideBand(h.config.road, 0, h.player.pos.s, 1);
    expect(h.player.pos.d).toBeGreaterThanOrEqual(band.lo);
    expect(h.player.pos.d).toBeLessThanOrEqual(band.hi);
    // The one respawn rule after any overboard (2026-10-07): the centre of a drive lane his way.
    expect(ownLaneCentres(h.config, 0, h.player.pos.s, 1)).toContain(h.player.pos.d);
    expect(h.player.speed).toBe(Math.min(REMOUNT, h.config.riders[0]?.bike.topSpeedMps ?? 0));
    expect(riderState(h.world).health[h.player.id]).toBe(100);
    expect(tumbleRecord(h.world, h.player.id)).toBeNull();
  });

  it("takes the gap's respawnPastM", () => {
    const h = harness(gapSimConfig(moser({ respawnPastM: 30 })), { s: 300, d: 1.7, speed: 25 });
    until(h, () => ofType(h, 'respawn').length > 0);
    expect(h.player.pos.s).toBeCloseTo(464 + 30, 6);
  });

  it('a rider travelling against s wakes past the gap the other way', () => {
    const bundle = gapBridge({ features: [gapFeature('hole', 600, 640)] });
    const config = gapSimConfig(bundle, {
      route: {
        id: 'r',
        network: bundle.network.id,
        start: { road: 'a', s: 1480, dir: -1 },
        finish: { road: 'a', s: 20 },
        mainPath: ['a'],
        allowedRoads: ['a'],
        closed: false,
      },
    });
    const h = harness(config, { s: 660, d: -1.7, speed: 12 });
    h.player.pos.dir = -1;
    until(h, () => ofType(h, 'respawn').length > 0);
    console.log(`[examined] dir -1: respawn at s ${h.player.pos.s.toFixed(2)} dir ${h.player.pos.dir}`);
    expect(h.player.pos.s).toBeCloseTo(600 - GAP_DEFAULTS.respawnPastM, 6);
    expect(h.player.pos.dir).toBe(-1);
  });

  it('a tumble body never rests inside the gap: one that slides into it falls through', () => {
    const config = gapSimConfig(gapBridge({ features: [gapFeature('hole', 300, 330)] }));
    const h = harness(config, { s: 290, d: 1.7, speed: 25 }, { tick: 3 });
    // Resting on the gap: a body not overboard, its centre over the box at deck level, for half a
    // second running. One passing through the deck plane is there for a few ticks at most.
    const REST_TICKS = 30;
    const onGap = { rider: 0, bike: 0 };
    let worst = '';
    until(h, () => {
      const r = tumbleRecord(h.world, h.player.id);
      for (const c of r ? [r.riderRig, r.bikeRig] : []) {
        const n = c.p.length;
        const at = c.p.reduce((a, q) => ({ x: a.x + q.x / n, y: a.y + q.y / n, z: a.z + q.z / n }), {
          x: 0,
          y: 0,
          z: 0,
        });
        const p = h.config.road.project(at.x, at.z, 0);
        const level = at.y <= h.config.road.surfaceHeight(p.edge, p.s, p.d) + 0.3;
        const on = !c.overboard && level && gapAt(h.config.road, p.edge, p.s, p.d) !== null;
        onGap[c.kind] = on ? onGap[c.kind] + 1 : 0;
        if (onGap[c.kind] >= REST_TICKS) worst = `${c.kind} lying on the gap at s ${p.s.toFixed(2)}`;
      }
      return ofType(h, 'respawn').length > 0;
    });
    const rails = ofType(h, 'railOver');
    console.log(
      `[examined] injected crash @${ofType(h, 'crash')[0]?.tick}: railOver ${rails.map((e) => `${String(e.data['body'])} gap ${String(e.data['gap'])}`).join(',')}; respawn at s ${h.player.pos.s.toFixed(2)}; body on the gap: ${worst || 'never'}`,
    );
    expect(worst).toBe('');
    expect(rails.length).toBeGreaterThan(0);
    expect(rails.every((e) => e.data['gap'] === true)).toBe(true);
    expect(h.player.pos.s).toBeCloseTo(330 + GAP_DEFAULTS.respawnPastM, 6);
  });
});

/**
 * The branch fixture compiled GAP_DECK_Y higher, with a gap on its straight shortcut `cut` that
 * wakes the rider on the main road (the Seven Mile's Moser gap: "respawn on the highway").
 */
function branchWithGap(): { bundle: BakedNetworkBundle; route: BakedRoute } {
  const base = fixtureBranchTrack();
  const out = compileTrack({
    ...base,
    baseElevationM: base.baseElevationM + GAP_DECK_Y,
    branches: (base.branches ?? []).map((b) => ({
      ...b,
      roads: b.roads.map((r) =>
        r.id === 'cut' ? { ...r, ramps: [], features: [gapFeature('hole', 40, 70, { respawn: 'main' })] } : r,
      ),
    })),
  });
  return {
    bundle: { network: out.network as unknown as BakedNetwork, roads: out.roads as unknown as BakedRoad[] },
    route: out.routes[0] as unknown as BakedRoute,
  };
}

describe("respawn: 'main', on the highway", () => {
  it("wakes on the route's main road, at the point nearest the splash, facing along the route", () => {
    const { bundle, route } = branchWithGap();
    const config = gapSimConfig(bundle, { route });
    const cut = config.road.edgeIndex('cut');
    const h = harness(config, { edge: cut, s: 20, d: 0, speed: 10 });
    until(h, () => ofType(h, 'respawn').length > 0);
    const splash = ofType(h, 'splash').find((e) => e.data['body'] === 'rider');
    const respawn = ofType(h, 'respawn')[0];
    if (!splash || !respawn) throw new Error('no rider splash or respawn');
    const sx = Number(splash.data['x']);
    const sz = Number(splash.data['z']);
    // The nearest main-road centreline point to the splash, by brute force every 0.25 m.
    const road = config.road;
    let best = Infinity;
    for (const e of config.route.mainEdges) {
      const len = road.edges[e]?.length ?? 0;
      for (let s = 0; s <= len; s += 0.25) {
        const w = road.toWorld(e, s, 0, 0);
        best = Math.min(best, Math.hypot(w.x - sx, w.z - sz));
      }
    }
    const pos = h.player.pos;
    const at = road.toWorld(pos.edge, pos.s, 0, 0);
    const got = Math.hypot(at.x - sx, at.z - sz);
    console.log(
      `[examined] splash (${sx.toFixed(1)}, ${sz.toFixed(1)}); respawn ${JSON.stringify(respawn.data)} on ${road.edges[pos.edge]?.id} s ${pos.s.toFixed(2)} dir ${pos.dir}: ${got.toFixed(2)} m from the splash, nearest main point ${best.toFixed(2)} m`,
    );
    expect(respawn.data).toMatchObject({ reason: 'splash', gap: 'hole', at: 'main' });
    expect(config.route.mainEdges).toContain(pos.edge);
    expect(got).toBeLessThanOrEqual(best + 0.25);
    expect(pos.dir).toBe(config.route.orientation(pos.edge));
    const band = ownSideBand(road, pos.edge, pos.s, pos.dir);
    expect(pos.d).toBeGreaterThanOrEqual(band.lo);
    expect(pos.d).toBeLessThanOrEqual(band.hi);
    expect(ownLaneCentres(config, pos.edge, pos.s, pos.dir)).toContain(pos.d);
    expect(h.player.mode).toBe('Road');
  });
});

/** The centres of the drive lanes running `dir` at (edge, s): where a splash respawn wakes him. */
function ownLaneCentres(config: SimConfig, edge: number, s: number, dir: number): number[] {
  return config.road
    .lanesAt(edge, s)
    .filter((l) => l.kind === 'drive' && l.direction === dir)
    .map((l) => l.dCenterM);
}

describe('determinism', () => {
  /** World hashes every 30 ticks of a run of n ticks. */
  function hashes(config: SimConfig, n: number): number[] {
    const h = harness(config, { s: 300, d: 1.7, speed: 25 });
    const out: number[] = [];
    for (let t = 0; t < n; t++) {
      h.step();
      if (t % 30 === 0) out.push(worldHash(h.world));
    }
    return out;
  }

  it('a missed gap, run twice, hashes the same tick for tick', () => {
    const a = hashes(gapSimConfig(moser()), 600);
    const b = hashes(gapSimConfig(moser()), 600);
    expect(b).toEqual(a);
  });

  it('a gap nobody reaches changes nothing: the same hashes as the road without it', () => {
    const plain = hashes(gapSimConfig(gapBridge()), 400);
    const unreached = hashes(gapSimConfig(gapBridge({ features: [gapFeature('far', 1400, 1450)] })), 400);
    expect(unreached).toEqual(plain);
    // The tumble state of a rider never down holds nothing new.
    const h = harness(gapSimConfig(gapBridge()), { s: 300, d: 1.7, speed: 25 });
    h.step();
    expect(tumbleState(h.world).records[0]).toBeNull();
  });
});
