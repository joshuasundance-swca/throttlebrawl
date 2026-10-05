/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3's drift career events against the critic's C4 and G5: "the target is progression's
// purse-based figure, capped at 60 % of what T2.3's drift bot earns on that route at that tier's
// pace: an economic target with a feasibility gate". Every event in the packs with a required,
// drift-only style-cash objective is found from the packs (a new drift event joins the check by
// existing). The drift bot (tests/sim/drift-bot.ts) rides its route alone, at the event's own drift
// rate, on every bike a player could ride at the event's tier, and the poorest earner sets the cap:
// a target a rider on the weakest open bike could not reach, with a bot's perfect line, is no
// target. The bot's cash is a figure printed here, never a number copied into the assertion.
import { describe, expect, it } from 'vitest';
import { bikeLadder, careerDefs, eventPlan, globalTier } from '../../src/career';
import { botRace, median, REG, soloConfig, type BotRun } from './drift-bot';

/** The critic's C4 share: a drift target may be at most this much of what the bot banks. */
const CAP_SHARE = 0.6;
const DEFS = careerDefs(REG);
const LADDER = bikeLadder(REG, DEFS);

/** The drift cash a plan's required drift-only style-cash objective asks, or null. */
function driftTarget(key: string): number | null {
  const objective = eventPlan(REG, key).objectives.find((o) => {
    const kinds = o.params['kinds'];
    return o.kind === 'style-cash' && o.required && Array.isArray(kinds) && kinds.join() === 'drift';
  });
  const cash = objective?.params['cash'];
  return typeof cash === 'number' ? cash : null;
}

const DRIFT_EVENTS = Object.keys(REG.events)
  .filter((key) => driftTarget(key) !== null)
  .sort();

/** The bikes a player could ride the event on: every ladder bike open by the event's global tier. */
function bikesFor(key: string): string[] {
  const def = DEFS.find((d) => d.nodes.some((n) => `${d.pack}:${n.event}` === key || n.event === key));
  const node = def?.nodes.find((n) => `${def.pack}:${n.event}` === key || n.event === key);
  const g = def && node ? globalTier(DEFS, def, node.tier) : Infinity;
  return LADDER.filter((b) => b.opensAt <= g).map((b) => b.key);
}

describe('the drift career events', () => {
  it('there are drift events in the packs to check (the check is shown able to find them)', () => {
    console.log(`[print] drift events examined: ${DRIFT_EVENTS.join(', ')}`);
    expect(DRIFT_EVENTS.length).toBeGreaterThan(0);
    expect(DRIFT_EVENTS).toContain('region-pnw:pnw-t3-crown-point');
  });

  for (const key of DRIFT_EVENTS) {
    it(`${key}: its target is at most 60 % of what the drift bot banks on its route, on every open bike`, () => {
      const plan = eventPlan(REG, key);
      const route = plan.lengths[0]?.route;
      if (!route) throw new Error(`${key} has no route`);
      const target = driftTarget(key) ?? NaN;
      const bikes = bikesFor(key);
      expect(bikes.length, `${key}: bikes a player could ride it on`).toBeGreaterThan(0);
      const pack = key.slice(0, key.indexOf(':'));
      const race = { label: key, event: key, route: route.includes(':') ? route : `${pack}:${route}` };
      const cash: Record<string, number> = {};
      const runs: Record<string, BotRun> = {};
      for (const bike of bikes) {
        // Alone on the road with every world system off, the seed changes next to nothing the bot
        // meets, so two seeds a bike keep the run short.
        const seeds = [1, 2].map((seed) => botRace(soloConfig(race, bike, seed, {}, null)));
        cash[bike] = median(seeds.map((r) => r.driftCash));
        runs[bike] = seeds[0] as BotRun;
        for (const r of seeds) {
          expect(r.finished, `${key} on ${bike}: the bot finishes`).toBe(true);
          expect(r.crashes, `${key} on ${bike}: the bot never crashes`).toBe(0);
          expect(r.driftCash, `${key} on ${bike}: the bot banks drift cash`).toBeGreaterThan(0);
        }
      }
      const poorest = Math.min(...Object.values(cash));
      console.log(
        `[examined] ${key} on ${route}, the drift bot at the event's own rate (median of 2 seeds): ` +
          `${bikes.map((b) => `${b} $${cash[b]} (${runs[b]?.drifts} drifts)`).join('; ')}; ` +
          `target $${target} against a cap of $${(CAP_SHARE * poorest).toFixed(0)} (60 % of $${poorest})`,
      );
      expect(target).toBeGreaterThan(0);
      expect(target).toBeLessThanOrEqual(CAP_SHARE * poorest);
    }, 900_000);
  }
});
