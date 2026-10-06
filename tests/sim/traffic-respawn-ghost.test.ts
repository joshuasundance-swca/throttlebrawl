/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4 (the maintainer, 2026-10-05): "I've respawned behind stuck traffic and crashed
// repeatedly", then "maybe clip through if that happens" and "low speeds should wobble not crash".
// Back on the bike (a remount after the run-back or a skip, or a splash respawn) a rider is a ghost to
// traffic for a moment (sim/traffic startTrafficGhost), and every contact with a vehicle is decided by
// its closing speed (sim/traffic/contact-rule.ts). Over seeded races in all three regions:
// - no rider back on the bike is touched by traffic (no crash, no wobble) while its ghost is on, no
//   ghost ends before `traffic.respawnGhostS` while its rider still rides, and none outlasts its cap;
// - the share of riding crashes that come within 5 s of a rider getting back on the bike stays under
//   BAND (its reasons are on it);
// - a race with ghosts in it replays to the same hash.
// The Keys race is the shared batch's (tests/sim/batch.ts; its hook tests/sim/hooks/respawn.ts), so no
// extra races run for it. The Pacific Northwest and San Francisco races run here, with the ISOLATED
// profile and traffic on: the behaviour under test is traffic's, and the rivals' fights stay (they
// knock riders off, and so put them back on the bike).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimInput } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, ISOLATED, simBatch, type BatchResult } from './batch';
import { respawnTracker, type RespawnHookResult } from './hooks/respawn';

/** traffic.respawnGhostS (1.5 s) and the ghost's hard cap (4 s, TRAFFIC.ghostCapS), in ticks. */
const MIN_GHOST_TICKS = 90;
const CAP_TICKS = 240;
/**
 * The most riding crashes that may come within 5 s of their rider getting back on the bike, as a
 * share of all riding crashes, pooled over this file's races. Measured in the lane's diagnosis, the
 * bot in the player's seat, before this change and after it:
 * - six career races over the three regions, 10 seeds each, the game's full field: 35 of 617 crashes
 *   (5.7 %, 16 of them inside the first 1.5 s) before, 10 of 448 (2.2 %, none inside 1.5 s) after;
 * - this file's races: the batch's Keys race 6 of 233 (2.6 %) before, 2 of 184 (1.1 %) after; the
 *   four region races 2 of 34 before, 3 of 29 after (the bot riding into the oncoming lanes of the
 *   Bridge City four-lane two seconds after each remount, a bot habit); pooled 3.0 % before, 2.3 %
 *   after (5 of 213).
 * 5 % sits under the old rate where the loop showed (the career races) and leaves the new rate room for
 * the seeds' scatter: 11 such crashes of about 213, the first count over it, is a 1.4 % draw at the
 * measured 5 (Poisson). On this file's own few races the band does not separate the old build from the
 * new; the hard rules do (the old build fails them on all 34 backs of the four region races: no ghost
 * at all). The band guards against crashes piling up just after the ghost ends.
 */
const BAND = 0.05;

let batch: BatchResult;

beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

/** The hard rules, for one race's tracker result. */
function expectFair(r: RespawnHookResult, where: string): void {
  expect(r.touchedWhileGhost, where).toEqual([]);
  expect(r.shortGhosts, where).toEqual([]);
  for (const g of r.ghostTicks) expect(g, where).toBeLessThanOrEqual(CAP_TICKS);
}

function sum(results: readonly RespawnHookResult[]) {
  const all = { backs: 0, respawns: 0, againTraffic: 0, crashes: 0, soon: 0, ghosts: [] as number[] };
  for (const r of results) {
    all.backs += r.backs;
    all.respawns += r.respawns;
    all.againTraffic += r.againTraffic;
    all.crashes += r.crashes;
    all.soon += r.crashesSoonAfter;
    all.ghosts.push(...r.ghostTicks);
  }
  return all;
}

const pct = (a: number, b: number) => `${((100 * a) / Math.max(1, b)).toFixed(1)} %`;

function line(name: string, results: readonly RespawnHookResult[]): string {
  const all = sum(results);
  const extended = all.ghosts.filter((g) => g > MIN_GHOST_TICKS).length;
  return (
    `${name}: ${all.backs} backs on the bike (${all.respawns} splash respawns), ${all.againTraffic} followed ` +
    `by a traffic crash within 5 s (${pct(all.againTraffic, all.backs)}); ${all.crashes} riding crashes, ` +
    `${all.soon} within 5 s of a back (${pct(all.soon, all.crashes)}); ${extended} of ${all.ghosts.length} ` +
    `ghosts ran past the minimum`
  );
}

function batchResults(): RespawnHookResult[] {
  return batch.races.map((race) => {
    const r = race.hooks['respawn'] as RespawnHookResult | undefined;
    if (!r) throw new Error(`seed ${race.seed}: no respawn hook result`);
    return r;
  });
}

describe('back on the bike: a fair restart (the Keys, the shared batch)', () => {
  it('no traffic touches a ghost, no ghost is cut short or outlasts its cap', () => {
    const results = batchResults();
    results.forEach((r, i) => expectFair(r, `seed ${batch.races[i]?.seed}`));
    console.log(`[examined] ${line(`${batch.races.length} batch races`, results)}`);
    expect(sum(results).backs).toBeGreaterThan(100);
  });
});

// ---- the other two regions --------------------------------------------------------------------

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const REGION_EVENTS = ['region-pnw:pnw-t1-bridge-city', 'region-sf:sf-hill-sprint'];
const SEEDS = [1, 2];
const MAX_TICKS = 60 * 60 * 6;

/** One region race with the bot, ISOLATED but for traffic; its tracker result, inputs and final hash. */
function regionRace(eventId: string, seed: number, replay?: readonly SimInput[]) {
  const tuning = { ...ISOLATED, 'traffic.density': 1 };
  const config = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), { seed, eventId, tuning });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const tracker = respawnTracker(MIN_GHOST_TICKS);
  const inputs: SimInput[] = [];
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS && (!replay || sim.tick < replay.length)) {
    let input: SimInput;
    if (replay) input = replay[sim.tick] ?? { steer: 0, throttle: 0, brake: 0, flags: 0 };
    else {
      const actions = emptyActions();
      bot.drive(snap, playerId, config.route, actions);
      input = toSimInput(actions);
    }
    inputs.push(input);
    sim.step([input]);
    snap = sim.snapshot();
    tracker.onTick(snap, sim.events());
  }
  return { result: tracker.result(), inputs, hash: sim.hash() };
}

describe('back on the bike: a fair restart (the Pacific Northwest, San Francisco, and all three pooled)', () => {
  it('holds the hard rules, replays to the same hash, and keeps crashes soon after a back under the band', () => {
    const results: RespawnHookResult[] = [];
    let replayed = false;
    for (const eventId of REGION_EVENTS) {
      for (const seed of SEEDS) {
        const race = regionRace(eventId, seed);
        expectFair(race.result, `${eventId} seed ${seed}`);
        results.push(race.result);
        // Determinism: the first race with a ghost in it, replayed from its inputs, ends on its hash.
        if (!replayed && race.result.ghostTicks.length > 0) {
          replayed = true;
          expect(regionRace(eventId, seed, race.inputs).hash, `${eventId} seed ${seed} replay`).toBe(
            race.hash,
          );
        }
      }
    }
    const pooled = [...batchResults(), ...results];
    const all = sum(pooled);
    console.log(`[examined] ${line(`${REGION_EVENTS.join(', ')}, seeds ${SEEDS.join(' and ')}`, results)}`);
    console.log(`[examined] ${line('pooled with the batch', pooled)}; band ${pct(BAND * 1000, 1000)}`);
    expect(replayed).toBe(true);
    expect(sum(results).backs).toBeGreaterThan(10);
    expect(all.soon / all.crashes).toBeLessThan(BAND);
  }, 240_000);
});
