// ai-2's seeded-race assertion (docs/milestones/M2.md, "ai-2 · Rivals who feel the hits"): a rival
// who holds a grudge against the player swings at them more, and rides closer. The grudge's own
// effect, as an A/B on the real race: the same seeded race run twice, identical until a racer-style
// rival first rides within 30 m of the player after 20 s; then in one run it holds a grudge against
// the player (noteGrudge, the fact tumble-2 writes) and in the other it does not. Over the next 60 s
// it must swing at the player more, and ride close to them longer, with the grudge. A racer only
// hunts someone it holds a grudge against; a heavy-hitter already hunts the player first, so a
// grudge changes nothing measurable for it. M4 rivals-1 gave the four regulars their own styles, so
// "racer-style" now means any style that does not hunt by itself (`plainHunter` below: Dial-Up the
// weaver and Chad the showboat in the base race). With `ai.styleQuirks` on, the showboat is left out
// too: he will not take on a player healthier than him, grudge or not.
//
// tests/sim/ai-feel.test.ts prints the shared batch's grudge rates and says why they are no longer
// asserted. This A/B lived there until 2026-10-05 and moved here unchanged: it reads no batch, so in
// its own file it no longer waits about 280 s for one, and CI can run it on another runner.
import { describe, expect, it } from 'vitest';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import type { SimConfig } from '../../src/sim/api';
import { huntsByDefault, resolveProfile } from '../../src/sim/ai';
import { createSimWithWorld } from '../../src/sim/create';
import { noteGrudge } from '../../src/sim/world';
import { createBatchRace } from './batch';

/** The A/B's seeds, its window and "close" (a fight's distance), [default]. */
/**
 * Seeds are drawn from this pool, in order, until AB_RACES of them have a racer-style rival within
 * 30 m of the player after 20 s. (A fixed list of six stopped being enough when the playtest 1c
 * launch punch spread the field: seeds 1 and 3 no longer qualify.)
 *
 * 16 races, not 6: six held only 3 to 7 swings a side, so any change to the race reshuffled the
 * verdict. When branch riders started touching traffic (#426), the first six read 3 swings without
 * the grudge and 3 with it, while 16 read 10 and 18 (main: 9 and 26), and 20 read 10 and 24.
 */
const AB_SEED_POOL = Array.from({ length: 20 }, (_, i) => i + 1);
const AB_RACES = 16;
/** Roadside weapon spacing for the A/B (see grudgeRun), m. */
const SPARSE_PICKUPS_M = 2000;
const AB_WINDOW_TICKS = 60 * 60;
const AB_CLOSE_M = 6;

/** A style that hunts only whom it holds a grudge against, and picks no fights by looks (rivals-1). */
const plainHunter = (style: string, quirks: boolean): boolean =>
  !huntsByDefault(style) && !(quirks && resolveProfile(style, undefined).traits.showboat);

/**
 * One A/B run: the base race with the bot, until a racer-style rival first rides within 30 m of the
 * player after 20 s; then, with `grudge`, that rival notes a grudge against the player. Returns its
 * swings at the player and the seconds it rode within AB_CLOSE_M of them over the next 60 s.
 */
function grudgeRun(seed: number, grudge: boolean) {
  const race = createBatchRace(seed);
  const { playerId, route } = race;
  // This measures the grudge, not the roadside weapons: W-Q laid one every 500 m (it was three a
  // race), and rivals holding them reshuffled this 6-race A/B (10 swings without, 9 with). One per
  // 2 km keeps about the old three on the batch's roads. Off-road (run W-R) off for the same reason:
  // it reshuffled these races too (2 swings without the grudge, 2 with; 6.3 s close without, 21.4 s
  // with), and with it off the riding model is exactly main's.
  const config: SimConfig = {
    ...race.config,
    tuning: { ...race.config.tuning, 'combat.pickupSpacingM': SPARSE_PICKUPS_M, 'ground.offRoad': 0 },
  };
  const quirks = (config.tuning['ai.styleQuirks'] ?? 0) >= 0.5;
  const { sim, world } = createSimWithWorld(config);
  const bot = createBot();
  let snap = sim.snapshot();
  let t0 = -1;
  let holder = -1;
  let swings = 0;
  let closeTicks = 0;
  while (!sim.isOver() && (t0 < 0 ? sim.tick < 60 * 600 : sim.tick < t0 + AB_WINDOW_TICKS)) {
    const me = snap.entities[playerId];
    if (t0 < 0 && sim.tick >= 60 * 20 && me?.mode === 'Road') {
      for (const e of snap.entities) {
        const c = config.riders[e.id]?.controller;
        if (e.kind !== 'rider' || e.mode !== 'Road' || c?.kind !== 'ai' || !plainHunter(c.style, quirks))
          continue;
        if (Math.abs(e.progress - me.progress) > 30) continue;
        holder = e.id;
        t0 = sim.tick;
        if (grudge) noteGrudge(world, holder, playerId);
        break;
      }
    }
    const a = emptyActions();
    bot.drive(snap, playerId, route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    if (t0 < 0) continue;
    for (const e of sim.events())
      if (e.type === 'attackStart' && e.actor === holder && e.target === playerId) swings++;
    const h = snap.entities[holder];
    const p = snap.entities[playerId];
    if (h && p && !h.finished && !p.finished && Math.abs(h.progress - p.progress) <= AB_CLOSE_M) closeTicks++;
  }
  return { t0, holder, swings, closeS: closeTicks / 60 };
}

// Vitest hides console output of passing tests, so the summary goes straight to stdout.
const print = (line: string) => process.stdout.write(line + '\n');

describe('ai-2: a rival you knocked off comes after you (A/B)', () => {
  it('a rival who holds a grudge against the player swings at them more, and rides closer (A/B)', () => {
    const rows: string[] = [];
    let swingsOff = 0;
    let swingsOn = 0;
    let closeOff = 0;
    let closeOn = 0;
    let examined = 0;
    for (const seed of AB_SEED_POOL) {
      if (examined >= AB_RACES) break;
      const off = grudgeRun(seed, false);
      const on = grudgeRun(seed, true);
      // Both runs are the same race until the grudge: the same moment and the same rival.
      expect(on.t0, `seed ${seed}`).toBe(off.t0);
      expect(on.holder, `seed ${seed}`).toBe(off.holder);
      if (off.t0 < 0) continue;
      examined++;
      swingsOff += off.swings;
      swingsOn += on.swings;
      closeOff += off.closeS;
      closeOn += on.closeS;
      rows.push(
        `seed ${seed} rival ${off.holder}: ${off.swings}→${on.swings} swings, ${off.closeS.toFixed(1)}→${on.closeS.toFixed(1)} s close`,
      );
    }
    print(
      `[ai-2] grudge A/B over ${examined} races (60 s after a racer-style rival first rides within 30 m of the player): ` +
        `swings at the player ${swingsOff} without the grudge, ${swingsOn} with it; within ${AB_CLOSE_M} m ` +
        `${closeOff.toFixed(1)} s without, ${closeOn.toFixed(1)} s with. ${rows.join('; ')}`,
    );
    expect(examined).toBe(AB_RACES);
    expect(swingsOn).toBeGreaterThan(swingsOff);
    expect(closeOn).toBeGreaterThan(closeOff);
  }, 300_000);
});
