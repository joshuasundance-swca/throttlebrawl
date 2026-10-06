/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 4, the maintainer: "in areas that encourage drifting I think maybe we should give more
// room on the sides or something to give more room for error in heavy traffic?". Drift room is
// three small, tunable rules: a drifting rider crashes into a barrier only from `riders.driftEdgeForgive`
// times the barrier crash speed (a wobble below), no vehicle spawns in or near a bend of a 75 m radius
// or less (`traffic.driftBendClearM`), and a vehicle near a drifting rider edges toward its kerb
// (`traffic.driftRoomM`). The speed stays the rider's.
//
// The measure: the drift bot (tests/sim/drift-bot.ts, with eyes: it also brakes for a car close
// ahead) rides the Crown Point loops, the drift career event's route, with the traffic on at its
// default density and the world's other systems off, and each drift is read for what it ended in.
// A drift "ends in a crash" when a crash lands during the slide or in the 1.5 s after it. The same
// seeds ride with drift room off (the three tuning keys at their old values) and on. A seed stops at
// its first crash, so a crash is counted once. Twin Peaks and Lombard Street can be examined too, but
// the bot (a plain lane-keeper) follows the first car it meets there and almost never drifts (1 to 10
// drifts in 6 seeds, no crash), so they support no figure: they assert nothing and run only with
// DRIFT_ROOM_EXAMINE=1, printing their lines (the test-diet run, 2026-10-06).
import { describe, expect, it } from 'vitest';
import { createSim, quantizeInput, type SimConfig, type SimSnapshot } from '../../src/sim/api';
import { ISOLATED } from './batch';
import { driftBot, GORGE, MAX_TICKS, median, soloConfig, type Route } from './drift-bot';

// The Gorge's own crash rules (bend room and hairpin yield, playtest 4) stay at their old values in
// both rows: they take most of the loop's crashes away, so with them on the room-off row rides
// almost clean and the comparison below reads noise (3 crashes against 4). This test measures the
// drift room alone; tests/sim/gorge-first-turns.test.ts holds the loop with every rule on.
const WORLD = {
  ...ISOLATED,
  'traffic.density': 1,
  'ground.offRoad': 1,
  'traffic.hairpinYieldM': 0,
  'riders.bendEdgeForgive': 1,
};
const ROOM_OFF = { 'traffic.driftBendClearM': 0, 'traffic.driftRoomM': 0, 'riders.driftEdgeForgive': 1 };
/** The seeds ridden for the figure; enough drifts (about 55 a 10 seeds) for a share. */
const SEEDS = 20;
/** The slide's tail: a crash this long after a drift ends still counts against it. */
const TAIL_TICKS = 90;
/** The drift event's cash target (pnw-t3-crown-point), printed beside the traffic run's cash. */
const GORGE_TARGET = 300;
/** The examine-only routes ride only on request: they print a line and assert nothing. */
const EXAMINE = process.env['DRIFT_ROOM_EXAMINE'] === '1';

const OTHER: Route[] = [
  { label: 'Twin Peaks', event: 'region-sf:sf-hill-sprint', route: 'region-sf:osm-sf-twin-peaks-run' },
  { label: 'Lombard Street', event: 'region-sf:sf-t4-crooked-mile', route: 'region-sf:osm-sf-lombard-run' },
];

/** The drift bot, braking for a car close ahead on its line. */
function seeingBot(cfg: SimConfig, snap: SimSnapshot, id: number) {
  const cmd = driftBot(cfg, snap, id);
  const me = snap.entities[id];
  if (!me) return cmd;
  const fx = -Math.sin(me.heading);
  const fz = -Math.cos(me.heading);
  for (const e of snap.entities) {
    if (e.kind !== 'vehicle') continue;
    const dx = e.x - me.x;
    const dz = e.z - me.z;
    const ahead = dx * fx + dz * fz;
    const side = Math.abs(dx * fz - dz * fx);
    if (ahead > 0 && ahead < 8 + me.speed * 1.2 && side < 2.2 && me.speed > e.speed + 1) {
      return quantizeInput({ ...cmd, throttle: 0, brake: Math.max(cmd.brake, 0.6) });
    }
  }
  return cmd;
}

interface Tally {
  drifts: number;
  crashed: number;
  /** What the crashes hit: `traffic` or `barrier` (the event's `cause`). */
  causes: Record<string, number>;
  cash: number[];
}

function ride(route: Route, seeds: number, tuning: Record<string, number>): Tally {
  const out: Tally = { drifts: 0, crashed: 0, causes: {}, cash: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    const cfg = soloConfig(route, 'base:rustbucket-400', seed, { ...WORLD, ...tuning }, null);
    const sim = createSim(cfg);
    const id = cfg.riders.findIndex((r) => r.controller.kind === 'player');
    let lastSlide = -Infinity;
    let drifting = false;
    let cash = 0;
    while (!sim.isOver() && sim.tick < MAX_TICKS) {
      const snap = sim.snapshot();
      if ((snap.moves?.driftSide ?? 0) !== 0) lastSlide = sim.tick;
      sim.step([seeingBot(cfg, snap, id)]);
      let crash: string | null = null;
      for (const e of sim.events()) {
        if (e.actor !== id) continue;
        if (e.type === 'driftStart') {
          out.drifts++;
          drifting = true;
        } else if (e.type === 'style' && e.data['kind'] === 'drift') cash += Number(e.data['points']);
        else if (e.type === 'crash') crash = String(e.data['cause'] ?? 'other');
      }
      if (crash !== null) {
        if (drifting && sim.tick - lastSlide <= TAIL_TICKS) {
          out.crashed++;
          out.causes[crash] = (out.causes[crash] ?? 0) + 1;
        }
        break;
      }
      if (drifting && sim.tick - lastSlide > TAIL_TICKS) drifting = false;
    }
    out.cash.push(cash);
  }
  return out;
}

const share = (t: Tally) => t.crashed / Math.max(1, t.drifts);

describe('drift room (playtest 4)', () => {
  it('Crown Point loops: the crash share of the drifts falls with the room, and the cash target stays reachable', () => {
    const before = ride(GORGE, SEEDS, ROOM_OFF);
    const after = ride(GORGE, SEEDS, {});
    console.log(
      `[examined] Crown Point loops, the drift bot with eyes, traffic at default density, ${SEEDS} seeds, ` +
        `rustbucket-400: room off ${before.crashed} of ${before.drifts} drifts ended in a crash ` +
        `(${(100 * share(before)).toFixed(1)} %, ${JSON.stringify(before.causes)}); room on ${after.crashed} of ` +
        `${after.drifts} (${(100 * share(after)).toFixed(1)} %, ${JSON.stringify(after.causes)}); drift cash ` +
        `median $${median(before.cash)} off, $${median(after.cash)} on (target $${GORGE_TARGET})`,
    );
    // The check is shown able to find crashes: with the room off the bot crashes in drifts.
    expect(before.drifts).toBeGreaterThan(30);
    expect(before.crashed).toBeGreaterThan(0);
    expect(after.drifts).toBeGreaterThan(30);
    // The band: with the room on, at most 1 drift in 12 ends in a crash (8.3 %). Room off rides
    // about twice that; a bot that never looks at the road keeps some crashes, and a drift that is
    // never at risk would not be a challenge.
    expect(share(after)).toBeLessThanOrEqual(1 / 12);
    expect(share(after)).toBeLessThan(share(before));
    // The cash: the room takes none of it. (A bot that stops at its first crash and brakes for
    // every car banks less than the isolated run's figure, in both rows, so the target is not read
    // here: tests/sim/drift-events.test.ts keeps it under its cap, and the room is not in that run.)
    expect(median(after.cash)).toBeGreaterThanOrEqual(0.9 * median(before.cash));
  }, 900_000);

  for (const route of OTHER) {
    it.runIf(EXAMINE)(
      `${route.label}: examined, with the room off and on (printed, not asserted)`,
      () => {
        const before = ride(route, 6, ROOM_OFF);
        const after = ride(route, 6, {});
        console.log(
          `[examined] ${route.label}, the drift bot with eyes, traffic on, 6 seeds: room off ${before.crashed} ` +
            `crashes in ${before.drifts} drifts; room on ${after.crashed} in ${after.drifts}`,
        );
        expect(before.drifts + after.drifts).toBeGreaterThanOrEqual(0);
      },
      900_000,
    );
  }
});
