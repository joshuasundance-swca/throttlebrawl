// tumble-2 acceptance over the shared 50-race seeded batch (docs/milestones/M2.md, tumble-2): with
// the fuller tumble, every crash hands back within its timeout, every splash respawns on the
// bridge within the penalty plus one second, and every race replays to identical hashes. It reads
// dev-1's cached batch (events only), so it runs no races of its own. dev-4's per-lane hook
// registry (tests/sim/hooks/) does not exist yet; this file moves there when it lands.
//
// A crash that starts a tumble ends in exactly one of: a `getUp` (the hand-back; its
// data.crashTick names the crash) or a `respawn` (after a splash; data.crashTick and
// data.splashTick). A crash event on a rider already down starts nothing (tumble-1's rule), and a
// `crash` whose data.contact is `tumble` is a flying body touching a car, not a rider going down.
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimEvent } from '../../src/sim/api';
import { BATCH_TIMEOUT_MS, simBatch, type BatchResult } from './batch';

/** tumble.timeoutS and tumble.splashPenaltyS at their starting values, in ticks. */
const TIMEOUT_TICKS = 300;
const PENALTY_TICKS = 240;
/** One second: hit-stops (timeScale 0) during a tumble stretch its clock in raw ticks. */
const SLACK_TICKS = 60;

let batch: BatchResult;

beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

const num = (e: SimEvent, key: string) => {
  const v = e.data[key];
  return typeof v === 'number' ? v : NaN;
};

describe('tumble-2 over the shared seeded batch', () => {
  it('hands every crash back within its timeout, and respawns every splash after the penalty', () => {
    let handbacks = 0;
    let respawns = 0;
    let splashes = 0;
    let railOvers = 0;
    let contacts = 0;
    let knocks = 0;
    let unfinished = 0;
    for (const race of batch.races) {
      const crashTicks = new Set<string>();
      for (const e of race.events) {
        if (e.type === 'crash' && e.data['contact'] !== 'tumble') crashTicks.add(`${e.actor}@${e.tick}`);
        if (e.type === 'crash' && e.data['contact'] === 'tumble') contacts++;
        if (e.type === 'crash' && e.data['cause'] === 'tumble' && e.data['contact'] !== 'tumble') knocks++;
        if (e.type === 'railOver') railOvers++;
      }
      for (const e of race.events) {
        const where = `seed ${race.seed} rider ${e.actor} tick ${e.tick}`;
        if (e.type === 'getUp') {
          handbacks++;
          const crash = num(e, 'crashTick');
          // It names a real crash of this rider, and came within the timeout.
          expect(crashTicks.has(`${e.actor}@${crash}`), where).toBe(true);
          expect(e.tick - crash, where).toBeGreaterThan(0);
          expect(e.tick - crash, where).toBeLessThanOrEqual(TIMEOUT_TICKS + SLACK_TICKS);
        }
        if (e.type === 'respawn') {
          respawns++;
          expect(e.data['reason'], where).toBe('splash');
          expect(crashTicks.has(`${e.actor}@${num(e, 'crashTick')}`), where).toBe(true);
          const waited = e.tick - num(e, 'splashTick');
          expect(waited, where).toBeGreaterThanOrEqual(PENALTY_TICKS);
          expect(waited, where).toBeLessThanOrEqual(PENALTY_TICKS + SLACK_TICKS);
        }
        if (e.type === 'splash') {
          // The first splash of a crash starts the penalty; its respawn follows, unless the race
          // ended first.
          const later = race.events.find(
            (r) => r.type === 'respawn' && r.actor === e.actor && r.tick >= e.tick && r.causeId === e.causeId,
          );
          if (!later) {
            unfinished++;
            expect(race.ticks - e.tick, where).toBeLessThanOrEqual(PENALTY_TICKS + SLACK_TICKS);
          }
          splashes++;
        }
      }
      // Every race replays to identical hashes.
      expect(race.firstMismatch, `seed ${race.seed}`).toBe(-1);
    }
    console.log(
      `[examined] ${batch.races.length} races: ${handbacks} hand-backs, ${respawns} splash respawns ` +
        `(${splashes} splash events, ${railOvers} railOver, ${unfinished} cut off by the race end), ` +
        `${contacts} body-car contacts, ${knocks} riders knocked off by a flying body`,
    );
    expect(batch.races.length).toBe(50);
    expect(handbacks).toBeGreaterThan(0);
  });
});
