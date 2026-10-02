/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

// road-3 acceptance ("each route's bot time is printed"): the bot rides each race length's route
// on the base pack, with the M1 event's full field, traffic and pedestrians, and finishes. The
// event only names the short route until riders-5 adds its lengths, so this builds the event's
// config and swaps in each route, as the race-length choice will.

const ROUTES = [
  // The M2 starting numbers: short about 2 minutes, standard about 4, long about 6.
  { id: 'm1-skeleton-sprint', minutes: 2 },
  { id: 'm1-standard-run', minutes: 4 },
  { id: 'm1-long-haul', minutes: 6 },
] as const;
const MAX_TICKS = 60 * 60 * 12;

function botRace(routeId: string, seed: number) {
  const reg = loadBasePack();
  const routeFile = lookup(reg.routes, routeId);
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  const built = buildSimConfig(reg, stream, { seed, eventId: DEFAULT_EVENT });
  const route = stream.routeFor(routeFile);
  // No cop: this test times the routes, and the dev bot never evades the law. On main at a455530,
  // with M1's fist damage, the long route ended in a bust on 4 of seeds 1-5, so the test rode on
  // one seed and any sim change could tip it over (playtest 2's knockdown retune did). The bust
  // rate is tests/sim/cops-bust-rate's job.
  const config: SimConfig = {
    ...built,
    riders: built.riders.filter((r) => r.faction !== 'law'),
    event: { ...built.event, routeId: `base:${routeId}` },
    route,
  };
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  let snap = sim.snapshot();
  let finishTick = -1;
  let problem: string | null = null;
  let offRoute = 0;
  let busted = false;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    const me = snap.entities[playerId];
    problem ??= me ? moverProblem(me, route) : 'no player';
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
    // Off the route only counts while racing: past a shorter route's line the road carries on,
    // so a finished rider coasts on into the next road (in seed 1's short race, into the Mangrove
    // Cut) until the race is over.
    if (me && finishTick < 0 && !route.allows(me.road.edge)) offRoute++;
    for (const e of sim.events()) if (e.type === 'bust' && e.target === playerId) busted = true;
  }
  return { finishTick, ticks: sim.tick, lengthM: route.length, problem, offRoute, busted, seed };
}

describe('road-3: the bot rides every race length', () => {
  it('finishes the short, standard and long routes, each in about its planned time (printed)', () => {
    const lines: string[] = [];
    let prev = 0;
    for (const r of ROUTES) {
      // Seeds 1 to 3 until the bot finishes: each seed also places the set pieces and re-rolls the
      // traffic and the cop's chase, and the dev bot never evades the cop, so a long race can end in
      // a bust (integration round: seed 1's long race did once the cop rode the launch punch). A race
      // it does not finish must still end in a bust, never a stall.
      let res = botRace(r.id, 1);
      for (let seed = 2; seed <= 3 && res.finishTick < 0; seed++) {
        expect(res.busted, `${r.id} seed ${res.seed}: a DNF is a bust, not a stall`).toBe(true);
        res = botRace(r.id, seed);
      }
      const s = res.finishTick / 60;
      lines.push(
        `${r.id} ${(res.lengthM / 1000).toFixed(2)} km, seed ${res.seed}: bot ${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')} ` +
          `(${(res.lengthM / s).toFixed(1)} m/s), race over at tick ${res.ticks}`,
      );
      expect(res.problem, r.id).toBeNull();
      expect(res.offRoute, r.id).toBe(0);
      expect(res.finishTick, `${r.id}: the bot finishes`).toBeGreaterThan(0);
      expect(res.finishTick, r.id).toBeGreaterThan(prev);
      prev = res.finishTick;
      // Within half either way of the planned minutes: a length, not a tuned lap time.
      expect(s / 60, r.id).toBeGreaterThan(r.minutes * 0.5);
      expect(s / 60, r.id).toBeLessThan(r.minutes * 1.5);
    }
    process.stdout.write(`[road-3] bot times: ${lines.join('; ')}\n`);
  }, 600_000);
});
