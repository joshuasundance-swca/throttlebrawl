/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
import { describe, expect, it } from 'vitest';
import { buildSimConfig } from '../../src/app';
import { buildRegistry, loadBasePack, lookup, type ContentRegistry, type PackFile } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

// The Pacific Northwest region (playtest 1c, 2026-09-30: "Pnw and sf first then others"): the bot
// rides the region's own race, Fogline Run, at every length, with the region's field (two touring
// regulars from base, the two locals), its local deputy, its traffic mix and its pedestrians, and
// finishes. The standard length is about 2 to 3 minutes.
//
// Until the runtime loads region packs, this test folds the region pack's entries into the base
// registry's tables under base ids, so the real buildSimConfig and sim run on them unchanged.

const RAW = import.meta.glob<unknown>('/packs/region-pnw/**/*.json', { eager: true, import: 'default' });
const PNW_FILES: PackFile[] = Object.keys(RAW)
  .sort()
  .map((key) => ({ path: key.replace(/^\/packs\/region-pnw\//, ''), json: RAW[key] }));

function withRegionPack(): ContentRegistry {
  const base = loadBasePack();
  const pnw = buildRegistry(PNW_FILES);
  const merged: Record<string, unknown> = { ...base };
  for (const [name, table] of Object.entries(pnw)) {
    if (name === 'packs' || name === 'index') continue;
    const rekeyed = Object.fromEntries(
      Object.entries(table as Record<string, unknown>).map(([k, v]) => [
        k.replace(/^region-pnw:/, 'base:'),
        v,
      ]),
    );
    merged[name] = { ...(base[name as keyof ContentRegistry] as object), ...rekeyed };
  }
  return merged as unknown as ContentRegistry;
}

const EVENT = 'pnw-fogline-run';
const MAX_TICKS = 60 * 60 * 10;

/** The region race's config, built the way the game builds one (app/config.ts). */
function raceConfig(lengthId: string, seed: number) {
  const reg = withRegionPack();
  const event = lookup(reg.events, EVENT);
  const length = event.lengths.find((l) => l.id === lengthId);
  const routeFile = lookup(reg.routes, length?.route ?? '');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  return buildSimConfig(reg, stream, { seed, eventId: EVENT, length: lengthId });
}

function botRace(lengthId: string, seed: number) {
  const config = raceConfig(lengthId, seed);
  const sim = createSim(config);
  const route = config.route;
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  let offRoute = 0;
  let maxTraffic = 0;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    problem ??= me ? moverProblem(me, route) : 'no player';
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
    if (me && finishTick < 0 && !route.allows(me.road.edge)) offRoute++;
    maxTraffic = Math.max(maxTraffic, snap.entities.length - config.riders.length);
  }
  // Where the player ended, for a failure message (the dev bot never evades the cop, so a bust
  // shows up here as a race over with the player short of the line).
  const me = snap.entities[playerId];
  const end = `tick ${sim.tick}, player on ${me?.road.edge} s ${me?.road.s.toFixed(0)}, ${me?.distanceToFinish.toFixed(0)} m to go`;
  return { config, finishTick, ticks: sim.tick, lengthM: route.length, problem, offRoute, maxTraffic, end };
}

describe('region-pnw: the bot races the Pacific Northwest headlessly', () => {
  it('builds the region race: its route, the local field and deputy, and its own traffic mix', () => {
    const config = raceConfig('short', 1);
    expect(config.route.length).toBeGreaterThan(2000);
    const names = config.riders.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Deacon Vane',
        'Chad Speedwell',
        'Old Growth',
        'Juniper Moss',
        'Deputy Lindqvist',
      ]),
    );
    // Sgt. Pruitt is the Keys' law; the region fields its own deputy.
    expect(names).not.toContain('Sgt. Pruitt');
    const weight = (id: string) => config.trafficTypes.find((t) => t.contentId === `base:${id}`)?.weight ?? 0;
    for (const id of ['log-truck', 'mossy-wagon', 'camper-van', 'ferry-walk-on', 'elk'])
      expect(weight(id), id).toBeGreaterThan(0);
    // The Keys' own box truck, tourists and chickens never spawn here.
    for (const id of ['box-truck', 'tourist-with-cooler', 'chicken']) expect(weight(id), id).toBe(0);
  });

  it('finishes the short, standard and long routes; the standard takes about 2 to 3 minutes (printed)', () => {
    const lines: string[] = [];
    let prev = 0;
    for (const lengthId of ['short', 'standard', 'long']) {
      const res = botRace(lengthId, 1);
      const s = res.finishTick / 60;
      lines.push(
        `${lengthId} ${(res.lengthM / 1000).toFixed(2)} km: bot ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')} ` +
          `(${(res.lengthM / s).toFixed(1)} m/s), up to ${res.maxTraffic} traffic and pedestrians`,
      );
      expect(res.problem, lengthId).toBeNull();
      expect(res.offRoute, lengthId).toBe(0);
      expect(res.finishTick, `${lengthId}: the bot finishes (${res.end})`).toBeGreaterThan(0);
      expect(res.finishTick, lengthId).toBeGreaterThan(prev);
      expect(res.maxTraffic, lengthId).toBeGreaterThan(0);
      prev = res.finishTick;
      if (lengthId === 'standard') {
        // The brief's "about 2 to 3 minutes", with the bot's slow passing in traffic.
        expect(s / 60).toBeGreaterThan(2);
        expect(s / 60).toBeLessThan(3.25);
      }
    }
    process.stdout.write(`[region-pnw] bot times, seed 1: ${lines.join('; ')}\n`);
  }, 600_000);
});
