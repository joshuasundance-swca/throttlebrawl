/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 3: drift as a first-class move, on the real roads the drift career events race (scratch
// spec moves.md §4.2 test 7; the critic's G5: "Drift events need T2.3 (the `drift` style kind and the
// bot's cash figure)"). A scripted drift bot rides each route: the dev bot's lane-keeping line, the
// brake and the bars together into every bend of 60 m radius or tighter (the drift's way in), the
// line held through it with the slide, and the bars let go after. It rides alone: the ISOLATED
// profile (every optional world system off), no rivals and no cop, so it measures the drift, not the
// field. Drift style cash is paid at perDriftSecondCash 1, so its figure scales straight to any
// event's rate (buildSimConfig's default is 3 × the event's perOncomingSecondCash).
//
// The G5 figure: the bot's banked drift cash per route and bike, printed. A drift event's target is
// capped at 60 % of it at the event's own rate (the critic's C4), rounded to 50.
import { describe, expect, it } from 'vitest';
import { createSim } from '../../src/sim/api';
import { botRace, GORGE, median, ROUTES, soloConfig } from './drift-bot';

describe('drift on the real hairpins', () => {
  it('the drift bot rides the Crown Point loops: it banks drift cash and never crashes, 5 seeds', () => {
    const seeds = [1, 2, 3, 4, 5];
    const runs = seeds.map((seed) => botRace(soloConfig(GORGE, 'base:rustbucket-400', seed)));
    console.log(
      `[examined] ${GORGE.label}, Rustbucket 400: ` +
        runs
          .map(
            (r, i) =>
              `seed ${seeds[i]} ${r.seconds.toFixed(1)} s, ${r.drifts} drifts, ${r.banks} banked, ` +
              `$${r.driftCash}, ${r.crashes} crashes`,
          )
          .join('; '),
    );
    for (const r of runs) {
      expect(r.finished).toBe(true);
      expect(r.crashes).toBe(0);
      expect(r.drifts).toBeGreaterThanOrEqual(5);
      expect(r.driftCash).toBeGreaterThan(0);
    }
  }, 300_000);

  it('drifting through the bends is quicker than braking through them on the same line', () => {
    // The same bot with the drift off brakes for every bend it would have drifted (the turn-in is
    // the brake): the drift's reach, its exit boost and the tighter line must buy back more than the
    // slide's drag costs.
    const on = botRace(soloConfig(GORGE, 'base:rustbucket-400', 1));
    const off = botRace(soloConfig(GORGE, 'base:rustbucket-400', 1, { 'riders.drift': 0 }));
    console.log(
      `[examined] ${GORGE.label}, seed 1: drift on ${on.seconds.toFixed(1)} s (${on.drifts} drifts), ` +
        `off ${off.seconds.toFixed(1)} s`,
    );
    expect(on.finished && off.finished).toBe(true);
    expect(off.drifts).toBe(0);
    expect(on.seconds).toBeLessThan(off.seconds);
  }, 300_000);

  it('a drifting race replays to the same state hash from its recorded inputs', () => {
    const config = soloConfig(GORGE, 'base:rustbucket-400', 2);
    const first = botRace(config);
    const sim = createSim(config);
    for (const cmd of first.inputs) sim.step([cmd]);
    expect(first.drifts).toBeGreaterThan(0);
    expect(String(sim.hash())).toBe(first.hash);
  }, 300_000);

  it('prints the G5 figure: the bot banked drift cash per route and bike, at $1 a drift second', () => {
    // Alone on the road with every world system off, the seed changes next to nothing the bot meets
    // (the first test's five seeds bank the same cash), so two seeds a case keep the run short.
    const seeds = [1, 2];
    const bikes = ['base:rustbucket-400', 'base:streetfighter-750', 'base:superbike-1000'];
    const lines: string[] = [];
    let gorge = 0;
    for (const c of ROUTES) {
      for (const bike of bikes) {
        const runs = seeds.map((seed) => botRace(soloConfig(c, bike, seed)));
        const cash = runs.map((r) => r.driftCash);
        lines.push(
          `${c.label}, ${bike}: median $${median(cash)} (seeds ${seeds.join(', ')}: ` +
            `${cash.map((x) => `$${x}`).join(', ')}), ${median(runs.map((r) => r.drifts))} drifts, ` +
            `${runs.reduce((n, r) => n + r.crashes, 0)} crashes, median ${median(runs.map((r) => r.seconds)).toFixed(1)} s`,
        );
        if (c === GORGE && bike === 'base:rustbucket-400') gorge = median(cash);
      }
    }
    console.log(`[G5] drift bot, banked drift cash at perDriftSecondCash 1:\n${lines.join('\n')}`);
    expect(lines).toHaveLength(ROUTES.length * bikes.length);
    expect(gorge).toBeGreaterThan(0);
  }, 600_000);
});
