/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Real roads as routes (the maintainer, 2026-10-01: "Yes, add as routes"): every real-road route a
// region offers races well with its region's full race around it. The bot rides each one with the
// event's field (regulars and locals), the local cop, the region's traffic and pedestrians, and
// the set pieces its seed places, and finishes (a race it does not finish must end in a bust, the
// dev bot never evades the cop, never a stall). The grid stands on the start road, the cop waits
// at the route's lot, and a seed replays to identical state hashes.
//
// The race loads the way the game loads it: every carried pack combined into one registry, the
// route picked with RaceSetup.route (app/config.ts).
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { chooseSetPieces } from '../../src/road';
import { createSim, type SimConfig } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 60 * 10;

/**
 * Every real-road route a region offers, with the event it is raced in. The region bakes carry
 * seeded set-piece slots; the Keys' Bahia Honda bake (gis-1) predates them and has none.
 */
const ROUTES = [
  { event: 'base:m1-skeleton-sprint', route: 'base:osm-bahia-honda-run', setPieces: false },
  { event: 'region-pnw:pnw-fogline-run', route: 'region-pnw:osm-chuckanut-run', setPieces: true },
  { event: 'region-pnw:pnw-fogline-run', route: 'region-pnw:osm-gorge-run', setPieces: true },
  { event: 'region-sf:sf-hill-sprint', route: 'region-sf:osm-sf-hills-run', setPieces: true },
  { event: 'region-sf:sf-hill-sprint', route: 'region-sf:osm-sf-twin-peaks-run', setPieces: true },
] as const;
type Case = (typeof ROUTES)[number];

function raceConfig(c: Case, seed: number): SimConfig {
  return buildSimConfig(REG, STREAMS.forEvent(REG, c.event, undefined, c.route), {
    seed,
    eventId: c.event,
    route: c.route,
  });
}

/** The region's pedestrian kinds, qualified (what its roadside zones spawn). */
function regionPeds(c: Case): string[] {
  const event = lookup(REG.events, c.event);
  const pack = c.event.slice(0, c.event.indexOf(':'));
  const region = lookup(REG.regions, `${pack}:${event.region}`);
  return (region.traffic.pedestrians ?? []).map((p) => (p.kind.includes(':') ? p.kind : `${pack}:${p.kind}`));
}

function botRace(c: Case, seed: number) {
  const config = raceConfig(c, seed);
  const sim = createSim(config);
  const route = config.route;
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  let offRoute = 0;
  let maxTraffic = 0;
  let busted = false;
  const hashes: number[] = [];
  const kinds = new Set<string>();
  const boosts: string[] = [];
  let jumps = 0;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    problem ??= me ? moverProblem(me, route) : 'no player';
    for (const e of snap.entities) {
      if (e.kind !== 'rider') kinds.add(e.contentId);
      problem ??= moverProblem(e, route);
    }
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
    if (me && finishTick < 0 && !route.allows(me.road.edge)) offRoute++;
    maxTraffic = Math.max(maxTraffic, snap.entities.length - config.riders.length);
    for (const e of sim.events()) {
      if (e.type === 'bust' && (e.actor === playerId || e.target === playerId)) busted = true;
      if (e.type === 'boost' && e.actor === playerId) boosts.push(String(e.data['feature']));
      if (e.type === 'jump' && e.actor === playerId) jumps++;
    }
    if (sim.tick % 60 === 0) hashes.push(sim.hash());
  }
  const end = `tick ${sim.tick}, player on edge ${snap.entities[playerId]?.road.edge} s ${snap.entities[playerId]?.road.s.toFixed(0)}`;
  return { config, finishTick, problem, offRoute, maxTraffic, busted, hashes, kinds, boosts, jumps, end };
}

describe('real roads as routes: each one races well inside its region race', () => {
  it('the regions offer exactly these real roads', () => {
    const offered = [
      ...new Set(ROUTES.map((c) => c.event).flatMap((e) => realRoutes(REG, e).map((r) => `${e} ${r}`))),
    ].sort();
    expect(offered).toEqual(ROUTES.map((c) => `${c.event} ${c.route}`).sort());
  });

  for (const c of ROUTES) {
    it(`${c.route}: the grid stands on the start road, the cop waits at the lot, the region's race is around it`, () => {
      const config = raceConfig(c, 1);
      expect(config.event.routeId).toBe(c.route);
      const sim = createSim(config);
      sim.step([toSimInput(emptyActions())]);
      const snap = sim.snapshot();
      const start = config.route.start;
      const startEdge = config.road.edgeIndex(lookup(REG.routes, c.route).start.road);
      const riders = snap.entities.filter((e) => e.kind === 'rider');
      expect(riders).toHaveLength(config.riders.length);
      const cops = config.riders.flatMap((r, i) => (r.faction === 'law' ? [i] : []));
      expect(cops.length, 'the local cop rides').toBeGreaterThan(0);
      for (const [i, e] of riders.entries()) {
        expect(moverProblem(e, config.route), `rider ${i}`).toBeNull();
        expect(e.road.edge, `rider ${i} starts on the start road`).toBe(startEdge);
        expect(e.road.s, `rider ${i} starts behind the line`).toBeLessThanOrEqual(start.s + 1);
        expect(Math.abs(e.road.d), `rider ${i} starts on the road or its lot`).toBeLessThan(10);
      }
      // The cop waits on the shoulder at the route's lot (its first copSpawn, s 4 to 20), off the
      // travel lanes, behind the grid (sim/cops copSpawnPos).
      for (const i of cops) {
        const cop = riders[i]?.road;
        expect(cop?.s ?? -1, 'the cop waits at the lot').toBeGreaterThanOrEqual(4);
        expect(cop?.s ?? 99, 'the cop waits at the lot').toBeLessThanOrEqual(20);
        expect(Math.abs(cop?.d ?? 0), 'on the shoulder').toBeGreaterThanOrEqual(4);
      }
      const own = buildSimConfig(REG, STREAMS.forEvent(REG, c.event), { seed: 1, eventId: c.event });
      expect(config.riders.map((r) => r.contentId)).toEqual(own.riders.map((r) => r.contentId));
      expect(config.trafficTypes).toEqual(own.trafficTypes);
      // Each seed places one candidate per set-piece slot (tests/sim/road-setpieces-live.test.ts
      // rides every candidate).
      expect(chooseSetPieces(config.road.edges, 1).size > 0).toBe(c.setPieces);
    });

    it(`${c.route}: the bot finishes the race (a DNF is a bust, never a stall), every mover valid`, () => {
      let res = botRace(c, 1);
      for (let seed = 2; seed <= 3 && res.finishTick < 0; seed++) {
        expect(res.busted, `a DNF is a bust, not a stall (${res.end})`).toBe(true);
        res = botRace(c, seed);
      }
      const s = res.finishTick / 60;
      const peds = regionPeds(c).filter((k) => res.kinds.has(k));
      process.stdout.write(
        `[real routes] ${c.route} ${(res.config.route.length / 1000).toFixed(2)} km, seed ${res.config.seed}: ` +
          `bot ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}, up to ${res.maxTraffic} traffic and pedestrians ` +
          `(${peds.join(', ') || 'no region pedestrians'}), boosts ${res.boosts.length}, jumps ${res.jumps}\n`,
      );
      expect(res.problem).toBeNull();
      expect(res.offRoute).toBe(0);
      expect(res.finishTick, `the bot finishes (${res.end})`).toBeGreaterThan(0);
      expect(res.maxTraffic).toBeGreaterThan(0);
      expect(peds.length, "the region's pedestrians stand at the roadside").toBeGreaterThan(0);
    }, 300_000);
  }

  it('a seed replays to identical state hashes on a real road; another seed differs', () => {
    const c = ROUTES[3];
    const a = botRace(c, 4);
    const again = botRace(c, 4);
    expect(again.hashes).toEqual(a.hashes);
    expect(again.finishTick).toBe(a.finishTick);
    const b = botRace(c, 5);
    expect(b.hashes.slice(0, 60)).not.toEqual(a.hashes.slice(0, 60));
    process.stdout.write(`[real routes] replay: ${c.route} seed 4, ${a.hashes.length} hashes equal\n`);
  }, 300_000);
});
