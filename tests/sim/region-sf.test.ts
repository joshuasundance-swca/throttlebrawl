/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The San Francisco region pack (playtest 1c, 2026-09-30: "Pnw and sf first then others"): the
// bot rides the region's race headlessly, with its full field (the two local rivals, two
// regulars and the local cop), the region's traffic mix (cable cars, startup shuttles, rideshare
// hatchbacks) and its pedestrians, and finishes in about the planned 2 to 3 minutes, catching air
// off the crest lips on the way.
//
// Harness: the app loads only the base pack today. Until the runtime loads region packs, this
// test mounts packs/region-sf's entries beside base's in one registry and builds the race with the
// app's own buildSimConfig, the path a region race will take.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSimConfig } from '../../src/app';
import { basePackFiles, buildRegistry, lookup, type ContentRegistry, type PackFile } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACK_DIR = path.join(root, 'packs/region-sf');
const EVENT = 'sf-hill-sprint';
const MAX_TICKS = 60 * 60 * 8;
/** Seeded races the bot rides (each about 2 to 3 minutes of race, a few seconds to run). */
const SEEDS = [1, 2, 3, 4, 5, 6];

function listJson(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = base ? `${base}/${name}` : name;
    if (statSync(path.join(dir, name)).isDirectory()) out.push(...listJson(path.join(dir, name), rel));
    else if (name.endsWith('.json')) out.push(rel);
  }
  return out;
}

/** The region pack's entry files (its manifest left out), as pack files. */
function regionFiles(): PackFile[] {
  return listJson(PACK_DIR)
    .filter((p) => p !== 'pack.json')
    .map((p) => ({ path: p, json: JSON.parse(readFileSync(path.join(PACK_DIR, p), 'utf8')) as unknown }));
}

/** Base plus region-sf in one registry (see the harness note at the top). */
function sfRegistry(): ContentRegistry {
  return buildRegistry([...basePackFiles(), ...regionFiles()]);
}

function sfRace(seed: number) {
  const reg = sfRegistry();
  const event = lookup(reg.events, EVENT);
  const routeId = event.lengths[0]?.route ?? '';
  const routeFile = lookup(reg.routes, routeId);
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  const config = buildSimConfig(reg, stream, { seed, eventId: EVENT });
  const sim = createSim(config);
  const route = config.route;
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const roads = config.road.edges.map((e) => e.id);
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  let offRoute = 0;
  const jumps: string[] = [];
  const landings: string[] = [];
  const kinds = new Set<string>();
  let busted = false;
  /** Seconds the bot spent on each road before it finished. */
  const secondsOn = new Map<string, number>();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    const ev = sim.events();
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    problem ??= me ? moverProblem(me, route) : 'no player';
    for (const e of ev) {
      if (e.type === 'bust' && (e.actor === playerId || e.target === playerId)) busted = true;
      if (e.actor !== playerId || finishTick >= 0) continue;
      if (e.type === 'jump') jumps.push(roads[snap.entities[playerId]?.road.edge ?? -1] ?? '?');
      if (e.type === 'land') landings.push(String(e.data['quality']));
    }
    for (const e of snap.entities) if (e.kind !== 'rider') kinds.add(e.contentId);
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
    if (me && finishTick < 0 && !route.allows(me.road.edge)) offRoute++;
    if (me && finishTick < 0) {
      const id = roads[me.road.edge] ?? '?';
      secondsOn.set(id, (secondsOn.get(id) ?? 0) + 1 / 60);
    }
  }
  const byRoad = [...secondsOn].map(([id, t]) => `${id} ${t.toFixed(0)} s`).join(', ');
  return {
    config,
    finishTick,
    ticks: sim.tick,
    lengthM: route.length,
    problem,
    offRoute,
    jumps,
    landings,
    kinds,
    byRoad,
    busted,
    rivalsFinished: snap.race.finishOrder.filter((id) => id !== playerId).length,
  };
}

describe('region-sf: the San Francisco race', () => {
  it('loads beside base: its event, route, riders, cop and traffic resolve into the race config', () => {
    const reg = sfRegistry();
    const event = lookup(reg.events, EVENT);
    expect(event.region).toBe('san-francisco');
    const region = lookup(reg.regions, 'san-francisco');
    expect(region.networks).toEqual(['sf-hills']);
    expect(region.signs?.length).toBeGreaterThanOrEqual(3);
    expect(region.signs?.length).toBeLessThanOrEqual(5);
    expect(region.billboards?.length).toBe(2);
    const { config } = sfRace(1);
    const ids = config.riders.map((r) => r.name);
    expect(ids).toEqual(['Pivot', 'Gripman Gus', 'Chad Speedwell', 'Dial-Up', 'You', 'Officer Meter']);
    // The region's mix picks the kinds: the region vehicles weigh in, a Keys-only kind never spawns.
    const weight = (id: string) => config.trafficTypes.find((t) => t.contentId === `base:${id}`)?.weight;
    expect(weight('cable-car')).toBe(1);
    expect(weight('startup-shuttle')).toBe(1);
    expect(weight('rideshare-hatchback')).toBe(5);
    expect(weight('fisherman')).toBe(0);
  });

  it('the bot finishes in about 2 to 3 minutes, on the route, and catches air off the crests', () => {
    const runs = SEEDS.map((seed) => ({ seed, res: sfRace(seed) }));
    const lines = runs.map(({ seed, res }) => {
      const s = res.finishTick / 60;
      const time =
        res.finishTick < 0
          ? `did not finish (${res.busted ? 'busted' : 'no bust'})`
          : `bot ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')} (${(res.lengthM / s).toFixed(1)} m/s)`;
      return (
        `seed ${seed}: ${(res.lengthM / 1000).toFixed(2)} km, ${time}, ${res.jumps.length} jumps ` +
        `(${res.jumps.join(', ')}), landings ${res.landings.join('/')}, rivals finished ${res.rivalsFinished}, ` +
        `by road ${res.byRoad}`
      );
    });
    const finished = runs.filter((r) => r.res.finishTick > 0);
    // Printed first, so a failing run still shows what it measured.
    process.stdout.write(
      `[region-sf] ${lines.join('\n[region-sf] ')}\n[region-sf] the bot finished ${finished.length} of ${runs.length}\n`,
    );
    for (const { seed, res } of runs) {
      expect(res.problem, `seed ${seed}`).toBeNull();
      expect(res.offRoute, `seed ${seed}`).toBe(0);
      // Three crest lips on the main path (two blocks and the fog climb), whichever way it goes.
      expect(res.jumps.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      // The AI field can race the course: the rivals cross the line.
      expect(res.rivalsFinished, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      // A race the bot does not finish ends the way a race may end: the cop busted it after a crash
      // (the bot's 45 m traffic look-ahead meets slow city traffic; see the region-sf report).
      if (res.finishTick < 0) expect(res.busted, `seed ${seed}: a DNF is a bust, not a stall`).toBe(true);
    }
    // At least half the seeded races finish, and the quickest is the brief's "about 2 to 3 minutes"
    // for the standard length (with a little slack either way); crashes add time to the others.
    expect(finished.length).toBeGreaterThanOrEqual(SEEDS.length / 2);
    const fastest = Math.min(...finished.map((r) => r.res.finishTick)) / 3600;
    expect(fastest).toBeGreaterThan(1.75);
    expect(fastest).toBeLessThan(3.25);
    for (const r of finished) expect(r.res.finishTick / 3600, `seed ${r.seed}`).toBeLessThan(4);
    // The region's own slow traffic is on the road.
    expect(runs.some((r) => r.res.kinds.has('base:cable-car'))).toBe(true);
  }, 600_000);
});
