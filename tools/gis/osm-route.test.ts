import { describe, expect, it } from 'vitest';
import { buildSimConfig, type ActionState } from '../../src/app';
import { loadBasePack, lookup, type ContentRegistry } from '../../src/content';
import { createStubBot } from '../../src/dev';
import { lintRoadNetwork } from '../../src/road';
import { createSim, quantizeInput, type SimConfig } from '../../src/sim/api';
import { activateRegion, type RegionStream } from '../../src/stream';

// gis-1 (docs/milestones/M2.md): the baked real road loads through the real content registry and
// the road module, and the bot finishes a race on it. No event points at the real route yet
// (road-4 decides), so the race reuses the default event's field on the real route.

const NETWORK = 'osm-keys-bahia-honda';
const ROUTE = 'osm-bahia-honda-run';

function streamFor(reg: ContentRegistry, networkId: string): RegionStream {
  const network = lookup(reg.networks, networkId);
  return activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
}

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

function realRoadConfig(seed: number): SimConfig {
  const reg = loadBasePack();
  const defaultRoute = lookup(reg.routes, lookup(reg.events, 'm1-skeleton-sprint').lengths[0]!.route);
  const base = buildSimConfig(reg, streamFor(reg, defaultRoute.network), { seed });
  const real = streamFor(reg, NETWORK);
  return { ...base, road: real.road, route: real.routeFor(lookup(reg.routes, ROUTE)) };
}

function botRace(seed: number) {
  const config = realRoadConfig(seed);
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createStubBot();
  const edges: number[] = [];
  const hashes: number[] = [];
  let invalid = 0;
  let playerFinishTick = -1;
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const me = sim.snapshot().entities[playerId];
    if (!me) throw new Error('no player');
    const a = blank();
    bot.drive(me, config.route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    const snap = sim.snapshot();
    for (const m of snap.entities) {
      const fields = [m.x, m.y, m.z, m.heading, m.speed, m.road.s, m.road.d];
      if (!fields.every(Number.isFinite) || m.road.s < 0 || m.road.s > config.route.edgeLength(m.road.edge))
        invalid++;
    }
    const after = snap.entities[playerId];
    if (after && edges[edges.length - 1] !== after.road.edge) edges.push(after.road.edge);
    if (playerFinishTick < 0 && snap.race.finishOrder.includes(playerId)) playerFinishTick = sim.tick;
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  return { sim, playerId, edges, hashes, invalid, playerFinishTick, config };
}

describe('gis: the real Overseas Highway stretch', () => {
  it('loads through the registry: 5 roads, 5-8 km, a long bridge, OSM provenance on every file', () => {
    const reg = loadBasePack();
    const network = lookup(reg.networks, NETWORK);
    const roads = network.roads.map((id) => lookup(reg.roads, id));
    const total = roads.reduce((n, r) => n + r.lengthM, 0);
    expect(roads.length).toBe(5);
    expect(total).toBeGreaterThanOrEqual(5000);
    expect(total).toBeLessThanOrEqual(8000);
    const bridges = roads.flatMap((r) =>
      (r.tags ?? []).filter((t) => t.tag === 'bridge').map((t) => t.s1 - t.s0),
    );
    expect(Math.max(...bridges)).toBeGreaterThanOrEqual(1500);
    for (const file of [network, ...roads]) {
      const sources = (file as { provenance?: { sources?: { spdx?: string }[] } }).provenance?.sources ?? [];
      expect(sources.some((s) => s.spdx === 'ODbL-1.0')).toBe(true);
    }
    const route = streamFor(reg, NETWORK).routeFor(lookup(reg.routes, ROUTE));
    expect(route.edgeLength(0)).toBeGreaterThan(0);
  });

  it('passes the road lint (src/road/validate.ts), which also fires on a broken copy', () => {
    const reg = loadBasePack();
    const network = lookup(reg.networks, NETWORK);
    const roads = network.roads.map((id) => lookup(reg.roads, id));
    const routes = [lookup(reg.routes, ROUTE)];
    const issues = lintRoadNetwork({ network, roads, routes });
    const samples = roads.reduce((n, r) => n + (r.samples.data['x']?.length ?? 0), 0);
    console.log(`road lint: ${roads.length} roads, ${samples} samples, 1 route, ${issues.length} issues`);
    expect(issues).toEqual([]);
    // Negative control: bend one road's stored curvature and the same lint must say so.
    const bent = structuredClone<typeof roads>(roads);
    const kappa = bent[1]!.samples.data['kappa'] as number[];
    kappa[500] = (kappa[500] ?? 0) + 0.02;
    kappa[501] = (kappa[501] ?? 0) + 0.02;
    expect(lintRoadNetwork({ network, roads: bent, routes }).map((i) => i.rule)).toContain('curvature');
  });

  it('the bot finishes a race on the real route, crossing every junction, every tick valid', () => {
    const run = botRace(7);
    const snap = run.sim.snapshot();
    const seconds = run.playerFinishTick / 60;
    console.log(
      `real route ${ROUTE}: bot finished in ${seconds.toFixed(1)} s (${run.playerFinishTick} ticks), ` +
        `race over at ${(run.sim.tick / 60).toFixed(1)} s, edges ${run.edges.join('>')}, ` +
        `finish order ${snap.race.finishOrder.join(',')}, ${run.config.riders.length} riders`,
    );
    expect(run.sim.isOver()).toBe(true);
    expect(run.playerFinishTick).toBeGreaterThan(0);
    expect(run.edges).toEqual([0, 1, 2, 3, 4]);
    expect(run.invalid).toBe(0);
  }, 120_000);

  it('replays to identical state hashes in the same run', () => {
    expect(botRace(11).hashes).toEqual(botRace(11).hashes);
  }, 240_000);
});
