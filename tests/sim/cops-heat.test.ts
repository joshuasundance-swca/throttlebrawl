/// <reference types="vite/client" />
// Playtest 2's heat meter in real races (the COPS answer: "Mix of 2 and 1 (reliable but rich)"):
// every region's event runs the meter, and the dev bot (which fights rivals down, so it makes chaos)
// raises heat, brings heat cops, and loses them again by riding on. Printed per region: the most
// heat and tier reached, heat cops sent, chases shaken off, busts and finishes. Release content,
// loaded the way the game loads it.
import { describe, expect, it } from 'vitest';
import { createHeadlessRace, regionChoices } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';

const REG = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const SEEDS = [1, 2, 3, 4, 5];
const MAX_TICKS = 60 * 60 * 6;

interface HeatRun {
  seed: number;
  maxHeat: number;
  maxTier: number;
  sent: number;
  /** Roadblock cops parked (tier 3). */
  blocks: number;
  lost: number;
  busted: boolean;
  finished: boolean;
  problem: boolean;
}

function heatRace(eventId: string, seed: number, tuning: Record<string, number> = {}): HeatRun {
  const { sim, config, playerId } = createHeadlessRace({ seed, eventId, tuning }, { registry: REG });
  const bot = createBot();
  const run: HeatRun = {
    seed,
    maxHeat: 0,
    maxTier: 0,
    sent: 0,
    blocks: 0,
    lost: 0,
    busted: false,
    finished: false,
    problem: false,
  };
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const a = emptyActions();
    bot.drive(snap, playerId, config.route, a);
    sim.step([toSimInput(a)]);
    snap = sim.snapshot();
    const law = snap.law;
    if (!law || !Number.isFinite(law.heat) || law.heat < 0 || law.heat > 1) run.problem = true;
    run.maxHeat = Math.max(run.maxHeat, law?.heat ?? 0);
    run.maxTier = Math.max(run.maxTier, law?.tier ?? 0);
    for (const e of sim.events()) {
      if (e.type === 'siren' && e.data['cause'] === 'heat' && e.data['on'] === true) run.sent++;
      if (e.type === 'siren' && e.data['cause'] === 'roadblock' && e.data['on'] === true) run.blocks++;
      if (e.type === 'heat' && e.data['lost'] === true) run.lost++;
      if (e.type === 'bust' && e.target === playerId) run.busted = true;
    }
    if (snap.race.finishOrder.includes(playerId)) run.finished = true;
  }
  return run;
}

describe('playtest 2: the heat meter in every region (the dev bot racing)', () => {
  for (const choice of regionChoices(REG)) {
    describe(`${choice.name}: chaos raises heat, which brings heat cops, and they are shaken off again`, () => {
      const runs: HeatRun[] = [];
      // Each complete seeded race gets the existing per-test budget. Grouping five complete
      // races under one budget could time out after all five finished on a slower runner.
      it.each(SEEDS)('seed %i has valid heat and ends', (seed) => {
        const run = heatRace(choice.eventId, seed);
        runs.push(run);
        expect(run.problem, `seed ${seed}: the snapshot's law is a heat in 0..1`).toBe(false);
        expect(run.busted || run.finished, `seed ${seed}: every race ends`).toBe(true);
      });
      it('the complete five-seed sample raises heat and sends heat cops', () => {
        expect(runs.map((run) => run.seed)).toEqual(SEEDS);
        process.stdout.write(
          `cops heat: ${choice.id}: ` +
            runs
              .map(
                (r) =>
                  `seed ${r.seed} max ${(r.maxHeat * 100).toFixed(0)} tier ${r.maxTier} sent ${r.sent} roadblock ${r.blocks} lost ${r.lost}` +
                  `${r.busted ? ' busted' : ''}${r.finished ? ' finished' : ''}`,
              )
              .join('; ') +
            '\n',
        );
        expect(runs.some((r) => r.maxHeat > 0)).toBe(true);
        expect(runs.some((r) => r.sent > 0)).toBe(true);
      });
    });
  }

  // Tier 3 in a real race: a rider three times as hot (cops.heatScale 3, a non-default) meets the
  // roadblock up the road, gets past it (round it, or into the back of it), and the race still ends.
  // Off-road stays off here (ground.offRoad 0), as the cops' difficulty runner pins it: with it on
  // (#343), the dev bot's turns on the loose verge cool its heat 3x as designed (HEAT.offRoadScale,
  // its own unit test in heat-meter.test.ts), so on the Pacific Northwest's 3.96 km road seed 1 hit
  // tier 3 only 22 m from the finish (no room for a block), seed 3 stopped at tier 2, and seed 2
  // found all four cops already out either way (main-green-4, 2026-10-02). This test is about the
  // roadblock, not the cooling.
  // The block also needs a cop who is free and out of sight when tier 3 comes, and the Pacific
  // Northwest's cops are often all out by then. Over seeds 1 to 8 there, 5 races reached tier 3 and
  // only 2 met a block on main (seeds 1 and 7), and 1 once the cops rode round traffic (#373: seed
  // 7); the misses had a clear stretch ahead but no free cop, or came too near the finish. So each
  // region rides seeds in order, at least 3 and up to ROADBLOCK_SEEDS, until one meets the block.
  // That was still a floor at the measured rate. The Pacific Northwest fields 4 cops, and when tier 3
  // comes, tiers 1 and 2 have usually sent 3 of them, so 0 or 1 is free and 120 m out of sight. On
  // main, seeds 1 to 10 met 1 block (seed 7); with #388's weapon verbs, seeds 1 to 10 met none,
  // and seeds 1 to 30 met 7 (23%) (run W-T keeper). So the patrol rides at x2 here (more cops parked
  // dark, the reserve a block draws on): 12 of 30 met it with #388 (40%), 4 of 10 on main, and the
  // Keys and San Francisco still met it (4 and 7 of 8). And the search runs to 24 seeds, so a retune
  // that halves the rate still finds one.
  const ROADBLOCK_TUNING = { 'cops.heatScale': 3, 'ground.offRoad': 0, 'cops.patrolScale': 2 };
  const ROADBLOCK_SEEDS = 24;
  for (const choice of regionChoices(REG)) {
    it(`${choice.name}: a hot rider meets the roadblock, and the race still ends`, () => {
      const runs: HeatRun[] = [];
      for (let seed = 1; seed <= ROADBLOCK_SEEDS; seed++) {
        if (seed > 3 && runs.some((r) => r.blocks > 0)) break;
        runs.push(heatRace(choice.eventId, seed, ROADBLOCK_TUNING));
      }
      process.stdout.write(
        `cops roadblock: ${choice.id}: ` +
          runs
            .map(
              (r) =>
                `seed ${r.seed} tier ${r.maxTier} roadblock ${r.blocks}${r.busted ? ' busted' : ''}${r.finished ? ' finished' : ''}`,
            )
            .join('; ') +
          '\n',
      );
      for (const r of runs) expect(r.busted || r.finished, `seed ${r.seed}: every race ends`).toBe(true);
      expect(runs.some((r) => r.blocks > 0)).toBe(true);
    }, 240_000);
  }
});
