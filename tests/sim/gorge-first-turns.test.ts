/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// The Gorge's first turns (playtest 4, the maintainer on the Historic Columbia River Highway: "the
// first couple turns are very very prone to crashing"). From the grid the road runs a 124° left of
// a 46 m radius, then the Crown Point loop: 215° right at a 33 m radius, with the viaduct's rails on
// both sides of most of it, then a 157° left of 30 m. A rider who holds the throttle reaches the
// loop at 45 to 53 m/s on the Pacific Northwest's own bikes, while full lock holds 33 m only up to
// about 27 m/s, so the bike runs wide across the oncoming lane into the outer rail. Measured on main
// before this change (the riders below and three more habits, four bikes, 20 seeds a case: 480
// races): 329 (68.5 %) crashed in the first 600 m, nearly all in the loop: 220 into the outer rail
// (faster across than the 6 m/s crash speed) and 88 into traffic, mostly the oncoming car spawned
// just beyond the loop at the start, which met the field in it.
//
// The rules that fixed it, each a tuning key (the old rule when left out):
// - bend room, `riders.bendEdgeForgive`: a rider the bend carries onto its outer edge while holding
//   the bars into it crashes only from 3 times the barrier crash speed (sim/riders);
// - hairpin yield, `traffic.hairpinYieldM`: traffic waits short of a bend of 75 m radius or tighter
//   while riders come round it toward it, and does not appear where it could not stop in time
//   (sim/traffic).
// With both (and the bridge tapers, road/bridge-taper.ts), the same 480 races crashed 18 times (3.8 %),
// none into traffic.
//
// The rule: a phone-like rider at the route's typical speed (the throttle held, full lock in the
// bends, never braking for one; on the region's two shop bikes, in its right lane, at the far right
// and late on the bars) gets through the first 600 m with a crash in at most 1 race in 6. Why that
// band: it is still a 215° hairpin taken at nearly twice its holding speed, so some risk stays (the
// fastest bike, late on the bars, arrives at 52 m/s and can still hit the rail too hard), but no
// longer the near-certain crash it was (a rider who brakes for the loop crashed in 1 race of 80).
// The same riders with both rules off are the control: at least half of their races crash there,
// so the check can see a crash.
import { describe, expect, it } from 'vitest';
import { phoneRide, raceConfig, type PhoneRider } from './phone-rider';

const EVENT = 'region-pnw:pnw-t3-gorge';
const ROUTE = 'region-pnw:osm-gorge-run';
/** The Pacific Northwest shop's bikes (careers/pnw-circuit.json): tier 2's and tier 4's. */
const BIKES = ['region-pnw:grand-tourer-1100', 'region-pnw:supersport-900'];
const RIDERS: PhoneRider[] = [
  { habit: 'line', lineD: 2 },
  { habit: 'line', lineD: 4.75 },
  { habit: 'late', lineD: 2 },
];
const SEEDS = 8;
/** The first three bends and the loop's exit, m from the grid. */
const FIRST_TURNS_M = 600;
/** Where the Crown Point loop begins, m from the grid (the arrival speed is read there). */
const LOOP_M = 223;
const RULES_OFF = { 'riders.bendEdgeForgive': 1, 'traffic.hairpinYieldM': 0 };

function share(tuning: Record<string, number>): {
  crashed: number;
  runs: number;
  causes: Record<string, number>;
  arrive: number[];
} {
  const out = { crashed: 0, runs: 0, causes: {} as Record<string, number>, arrive: [] as number[] };
  for (const bike of BIKES) {
    for (const r of RIDERS) {
      for (let seed = 1; seed <= SEEDS; seed++) {
        const run = phoneRide(raceConfig(EVENT, ROUTE, seed, bike, tuning), r, FIRST_TURNS_M, LOOP_M);
        out.runs++;
        out.arrive.push(run.speedAtMark);
        const first = run.crashes[0];
        if (!first) continue;
        out.crashed++;
        out.causes[first.cause] = (out.causes[first.cause] ?? 0) + 1;
      }
    }
  }
  return out;
}

describe('the Gorge first turns (playtest 4)', () => {
  it('a phone-like rider at the route speed gets through the first 600 m with a crash in at most 1 race in 6', () => {
    const off = share(RULES_OFF);
    const on = share({});
    const speeds = on.arrive.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    console.log(
      `[examined] osm-gorge-run from the grid to ${FIRST_TURNS_M} m, the full field and traffic, ${BIKES.join(' and ')}, ` +
        `${RIDERS.length} phone habits, ${SEEDS} seeds (${on.runs} races a row); loop arrival ${speeds[0]?.toFixed(1)} to ` +
        `${speeds[speeds.length - 1]?.toFixed(1)} m/s. Rules off: ${off.crashed} of ${off.runs} crashed ` +
        `${JSON.stringify(off.causes)}; on: ${on.crashed} of ${on.runs} ${JSON.stringify(on.causes)}`,
    );
    expect(off.crashed / off.runs).toBeGreaterThanOrEqual(1 / 2);
    expect(on.crashed / on.runs).toBeLessThanOrEqual(1 / 6);
  }, 600_000);
});
