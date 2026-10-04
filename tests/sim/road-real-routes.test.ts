/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Real roads as routes (the maintainer, 2026-10-01: "Yes, add as routes"): every real-road route a
// region offers races well with its region's full race around it. The bot rides each one with the
// event's field (regulars and locals), the local cop, the region's traffic and pedestrians, and
// the set pieces its seed places, and finishes (a race it does not finish must end in a bust, the
// dev bot never evades the cop, never a stall). The grid stands on the start road, the lot cop
// waits at the route's lot, the patrol (playtest 2) waits on the shoulder up the road, and a seed
// replays to identical state hashes.
//
// The race loads the way the game loads it: every carried pack combined into one registry, the
// route picked with RaceSetup.route (app/config.ts).
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { chooseSetPieces, setPieceSlots } from '../../src/road';
import { createSim, type SimConfig } from '../../src/sim/api';
import { NO_ROAD_EVENTS } from './batch';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const MAX_TICKS = 60 * 60 * 10;

interface Case {
  event: string;
  route: string;
}

/**
 * Every real-road route a region offers, with the region's free-play event it is raced in, read from
 * the packs (regionChoices, realRoutes): a road a lane adds is raced here the day it lands, and this
 * file holds no list to edit. Today: the Keys' Bahia Honda and Key West, the Pacific Northwest's
 * Chuckanut, the Gorge and I-5 by Lake Samish, and San Francisco's Russian Hill, Twin Peaks and its
 * hand-made districts (downtown, Chinatown and North Beach, the Mission, the waterfront).
 */
const ROUTES: readonly Case[] = regionChoices(REG).flatMap((c) =>
  realRoutes(REG, c.eventId).map((route) => ({ event: c.eventId, route })),
);

function raceConfig(c: Case, seed: number): SimConfig {
  // W-P road events off: this measures the riders, the AI, the law and traffic, and an event reshuffles
  // every seeded race (the events have their own tests: tests/sim/events-*.test.ts, e2e road-events).
  return buildSimConfig(REG, STREAMS.forEvent(REG, c.event, undefined, c.route), {
    seed,
    eventId: c.event,
    route: c.route,
    tuning: NO_ROAD_EVENTS,
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
  it("every route of a region is raced: the free-play event's lengths, a road it offers, or a career length on its own road", () => {
    // The rule the picker follows (the maintainer, 2026-10-01: "Yes, add as routes"; run W-R's
    // districts offered beside the real roads), so a route built but never offered fails, while a
    // new road needs no edit here.
    let examined = 0;
    for (const choice of regionChoices(REG)) {
      const pack = choice.eventId.slice(0, choice.eventId.indexOf(':'));
      const q = (id: string) => (id.includes(':') ? id : `${pack}:${id}`);
      const event = lookup(REG.events, choice.eventId);
      const own = new Set(event.lengths.map((l) => q(l.route)));
      const ownNetworks = new Set([...own].map((r) => q(REG.routes[r]?.network ?? '')));
      const offered = new Set(realRoutes(REG, choice.eventId));
      const careerLengths = new Set(
        Object.entries(REG.events)
          .filter(([id, e]) => e.tier !== undefined && id.startsWith(`${pack}:`))
          .flatMap(([, e]) => e.lengths.map((l) => q(l.route))),
      );
      for (const [id, r] of Object.entries(REG.routes)) {
        if (!id.startsWith(`${pack}:`) || REG.networks[q(r.network)]?.region !== event.region) continue;
        examined++;
        const raced =
          own.has(id) || offered.has(id) || (ownNetworks.has(q(r.network)) && careerLengths.has(id));
        expect(raced, `${id}: in ${choice.id}, but no race offers it`).toBe(true);
      }
    }
    process.stdout.write(
      `[real routes] ${examined} routes examined, ${ROUTES.length} offered as real roads\n`,
    );
    expect(ROUTES.length).toBeGreaterThan(0);
    expect(examined).toBeGreaterThan(ROUTES.length);
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
      const patrol = cops.filter(
        (i) => config.route.progressAt(riders[i]?.road.edge ?? -1, riders[i]?.road.s ?? 0) > 100,
      );
      // The start road's drawn half-width, its shoulders included: under 10 m on a two-lane road, 11.5
      // m on run W-S's four-lane I-5 (its lot cop parks on the shoulder, 10.75 m out).
      const half = Math.max(
        ...config.road.lanesAt(startEdge, start.s).map((l) => Math.abs(l.dCenterM) + l.widthM / 2),
      );
      for (const [i, e] of riders.entries()) {
        expect(moverProblem(e, config.route), `rider ${i}`).toBeNull();
        if (patrol.includes(i)) continue;
        expect(e.road.edge, `rider ${i} starts on the start road`).toBe(startEdge);
        expect(e.road.s, `rider ${i} starts behind the line`).toBeLessThanOrEqual(start.s + 1);
        expect(Math.abs(e.road.d), `rider ${i} starts on the road or its lot`).toBeLessThan(
          Math.max(10, half),
        );
      }
      // Playtest 2: up to two cops patrol (none here: these races turn the patrol off with the road
      // events), each on the shoulder up the road, inside the route's 8 % to 80 % (sim/cops PATROL),
      // off the travel lanes. tests/sim/cops-patrol.test.ts races the patrol on every route.
      expect(patrol.length, 'the patrol').toBeLessThanOrEqual(2);
      for (const i of patrol) {
        const cop = riders[i]?.road;
        const at = config.route.progressAt(cop?.edge ?? -1, cop?.s ?? 0);
        expect(at, 'the patrol waits up the road').toBeGreaterThanOrEqual(0.08 * config.route.length - 1);
        expect(at, 'the patrol waits up the road').toBeLessThanOrEqual(0.8 * config.route.length + 1);
        const off = config.road
          .lanesAt(cop?.edge ?? -1, cop?.s ?? 0)
          .filter((l) => l.kind === 'drive')
          .every((l) => Math.abs((cop?.d ?? 0) - l.dCenterM) >= l.widthM / 2);
        expect(off, 'the patrol waits off the travel lanes').toBe(true);
      }
      // The rest wait on the shoulder at the route's lot (its first copSpawn, s 4 to 20), off the
      // travel lanes, behind the grid (sim/cops copSpawnPos).
      for (const i of cops.filter((k) => !patrol.includes(k))) {
        const cop = riders[i]?.road;
        expect(cop?.s ?? -1, 'the cop waits at the lot').toBeGreaterThanOrEqual(4);
        expect(cop?.s ?? 99, 'the cop waits at the lot').toBeLessThanOrEqual(20);
        expect(Math.abs(cop?.d ?? 0), 'on the shoulder').toBeGreaterThanOrEqual(4);
      }
      const own = buildSimConfig(REG, STREAMS.forEvent(REG, c.event), { seed: 1, eventId: c.event });
      expect(config.riders.map((r) => r.contentId)).toEqual(own.riders.map((r) => r.contentId));
      expect(config.trafficTypes).toEqual(own.trafficTypes);
      // Each seed places one candidate per set-piece slot its roads carry (none on a bake that
      // predates them, such as the Keys' Bahia Honda; tests/sim/road-setpieces-live.test.ts rides
      // every candidate).
      const slots = [...setPieceSlots(config.road.edges).values()].filter((ids) => ids.length > 0);
      expect(chooseSetPieces(config.road.edges, 1).size).toBe(slots.length);
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
    // San Francisco's Russian Hill (the replay check's road since run W-O), or the first real road.
    const c = ROUTES.find((r) => r.route === 'region-sf:osm-sf-hills-run') ?? ROUTES[0];
    if (!c) throw new Error('no real-road route');
    const a = botRace(c, 4);
    const again = botRace(c, 4);
    expect(again.hashes).toEqual(a.hashes);
    expect(again.finishTick).toBe(a.finishTick);
    const b = botRace(c, 5);
    expect(b.hashes.slice(0, 60)).not.toEqual(a.hashes.slice(0, 60));
    process.stdout.write(`[real routes] replay: ${c.route} seed 4, ${a.hashes.length} hashes equal\n`);
  }, 300_000);
});
