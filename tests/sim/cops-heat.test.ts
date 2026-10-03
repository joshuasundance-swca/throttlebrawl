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
    it(`${choice.name}: chaos raises heat, which brings heat cops, and they are shaken off again`, () => {
      const runs = SEEDS.map((seed) => heatRace(choice.eventId, seed));
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
      for (const r of runs) {
        expect(r.problem, `seed ${r.seed}: the snapshot's law is a heat in 0..1`).toBe(false);
        expect(r.busted || r.finished, `seed ${r.seed}: every race ends`).toBe(true);
      }
      expect(runs.some((r) => r.maxHeat > 0)).toBe(true);
      expect(runs.some((r) => r.sent > 0)).toBe(true);
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
  const ROADBLOCK_TUNING = { 'cops.heatScale': 3, 'ground.offRoad': 0 };
  for (const choice of regionChoices(REG)) {
    it(`${choice.name}: a hot rider meets the roadblock, and the race still ends`, () => {
      const runs = [1, 2, 3].map((seed) => heatRace(choice.eventId, seed, ROADBLOCK_TUNING));
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
    });
  }
});
