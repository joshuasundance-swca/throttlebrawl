/// <reference types="vite/client" />
// Season 2 is harder, with the garage carried over (playtest 3, T7.5 balance QA; the maintainer,
// round 2: "Longer + seasons (Recommended)": "Season 2+ with a harder field and remixed events, the
// garage carried over"; round 3: "Both": Season 2 on his finished save). A modelled typical player
// (career-model.ts) finishes Season 1 through the career's own code on the real packs, then starts
// Season 2: what carries over, how much harder every node's field is, measured on one road in the
// sim, and that the remixed season can be played to its end.
import { describe, expect, it } from 'vitest';
import {
  canStartSeason,
  fieldLevel,
  progressOf,
  regionOpen,
  startSeason,
  type CareerNode,
} from '../../src/career';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig } from '../../src/sim/api';
import { ISOLATED } from './batch';
import { botView, careerRace, REG } from './career-harness';
import { DEFS, LADDER, PLAYERS, playSeason } from './career-model';

const print = (line: string) => process.stdout.write(`[career-season-two] ${line}\n`);

const seasonOne = playSeason(PLAYERS.typical, 20261004);
const s1 = seasonOne.profile;
const s2 = startSeason(DEFS, s1, 0x5eed2);

describe('Season 2 starts on the finished save, the garage carried over', () => {
  it('Season 1 ends with every region boss down, and the next season can start', () => {
    for (const def of DEFS) expect(progressOf(def, s1.regions).finaleBeaten, def.regionId).toBe(true);
    expect(canStartSeason(DEFS, s1)).toBe(true);
    print(
      `[examined] Season 1 in ${seasonOne.races} races; ${s1.bikes.owned.length} bikes owned, $${s1.cash}`,
    );
  });

  it('keeps the bikes, the bike ridden, the cash and the grudges; the maps start again, in order', () => {
    expect(s2.season).toBe(s1.season + 1);
    expect(s2.bikes).toEqual(s1.bikes);
    expect(s2.cash).toBe(s1.cash);
    expect(s2.grudges).toEqual(s1.grudges);
    for (const def of DEFS) expect(progressOf(def, s2.regions).won, def.regionId).toEqual([]);
    expect(DEFS.map((d) => regionOpen(DEFS, s2, d))).toEqual(DEFS.map((_, i) => i === 0));
  });
});

describe('every race of Season 2 is harder than the same race in Season 1', () => {
  const top = LADDER.at(-1);
  for (const def of DEFS)
    it(`${def.regionName}: faster, on the best bike, fighting at least as hard`, () => {
      for (const node of def.nodes) {
        const one = fieldLevel(REG, DEFS, def, node, 1);
        const two = fieldLevel(REG, DEFS, def, node, 2);
        if (!one || !two) throw new Error(node.id);
        expect(two.paceMps, node.id).toBeGreaterThan(one.paceMps);
        expect(two.rivalBike, node.id).toBe(top?.key);
        expect(two.aggressionScale, node.id).toBeGreaterThanOrEqual(one.aggressionScale);
        expect(two.healthScale, node.id).toBeGreaterThanOrEqual(one.healthScale);
        expect(two.powerScale, node.id).toBeGreaterThanOrEqual(one.powerScale);
        expect(two.signatureGapScale, node.id).toBeLessThanOrEqual(one.signatureGapScale);
      }
    });

  /** The leading rival's mean speed over ticks 600 to 3000, the player riding the race. */
  function leadSpeed(config: SimConfig): number {
    const sim = createSim(config);
    const me = config.riders.findIndex((r) => r.controller.kind === 'player');
    const rivals = config.riders.flatMap((r, i) => (r.role === 'rival' ? [i] : []));
    const bot = createBot();
    let snap = sim.snapshot();
    let sum = 0;
    let n = 0;
    for (let t = 0; t < 3000 && !sim.isOver(); t++) {
      const a = emptyActions();
      bot.drive(botView(snap, me, 'race'), me, config.route, a);
      sim.step([toSimInput(a)]);
      snap = sim.snapshot();
      if (t < 600) continue;
      const lead = rivals
        .map((i) => snap.entities[i])
        .sort((x, y) => (y?.progress ?? 0) - (x?.progress ?? 0))[0];
      sum += lead?.speed ?? 0;
      n++;
    }
    return sum / Math.max(1, n);
  }

  it("measured on one road: the first chapter's Season 2 field outruns its Season 1 field at every tier", () => {
    const def = DEFS[0];
    const road = def?.nodes.find((n) => n.tier === 0 && REG.events[n.event]?.kind === 'classic-race');
    if (!def || !road) throw new Error('no first race to the line');
    const lines: string[] = [];
    def.tiers.forEach((tier, t) => {
      const node = def.nodes.find((n: CareerNode) => n.tier === t);
      if (!node) throw new Error(tier.id);
      const speed = (season: number) => {
        const level = fieldLevel(REG, DEFS, def, node, season);
        if (!level) throw new Error(node.id);
        // Both seasons on the player's Season 1 garage at its end: the top bike.
        const xs = [1, 2].map((seed) =>
          leadSpeed(careerRace(def, road, s1, seed, { tuning: ISOLATED, level }).config),
        );
        return xs.reduce((a, b) => a + b, 0) / xs.length;
      };
      const [one, two] = [speed(1), speed(2)];
      lines.push(`${tier.id} ${one.toFixed(1)} -> ${two.toFixed(1)}`);
      expect(two, `${tier.id}: Season 2 against Season 1`).toBeGreaterThan(one);
    });
    print(
      `[examined] ${def.regionId}, 4 tiers x 2 seeds x 2 seasons on ${road.event}: ${lines.join('; ')} m/s`,
    );
  }, 300_000);
});

describe('the remixed Season 2 can be played to its end', () => {
  it('a typical player finishes Season 2 on the carried garage, every boss down, in chapter order', () => {
    const runs = Array.from({ length: 40 }, (_, i) => playSeason(PLAYERS.typical, 7000 + i, { start: s2 }));
    for (const r of runs) {
      for (const def of DEFS)
        expect(progressOf(def, r.profile.regions).finaleBeaten, def.regionId).toBe(true);
      expect(r.regionOrder).toEqual(DEFS.map((d) => d.regionId));
      expect(r.profile.season).toBe(2);
    }
    const lengths = runs.map((r) => r.races).sort((a, b) => a - b);
    print(`[examined] ${runs.length} Season 2 runs: ${lengths[0]} to ${lengths.at(-1)} races`);
  });
});
