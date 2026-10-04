/// <reference types="vite/client" />
// The field levels up every tier, measured in the sim (playtest 3, T7.5 balance QA; the
// maintainer, 2026-10-03: "No struggle, no increasing difficulty"; round 1: "the field levels up
// every tier (tier 3 rivals ride bikes as good as your best)"; round 3, "Gentle climb": "about 10%
// easier to knock down at a region's first tier, about 20% harder by its last; tunable").
//
// Each race here is built the way the app builds a career race (the harness's `careerRace`: the
// node's field level and the season's remix), so what is measured is what a player meets. The
// rules read the careers from the packs and hold for every region in chapter order:
// - a career race carries its field level into the race (the harness used to build races without
//   it, so the headless career rode today's field);
// - the rivals ride the best bike open at the tier from the tier its file says (`rivalBike`), the
//   rank below before that, and the law rides theirs, capped under the best open top speed;
// - on one shared road, so only the field level differs, the leading rival's speed climbs tier by
//   tier in every region and sits near the level's pace (a band over seeded races);
// - the fights climb gently: in every race of a region's first tier the rivals are easier to knock
//   down than a neutral field and fight less, and by its last tier they are about a fifth harder,
//   read from the running sim (each rival's `healthMax`) and the race's own fight scales.
import { describe, expect, it } from 'vitest';
import {
  bestOpenRank,
  bikeLadder,
  careerDefs,
  globalTier,
  startCareer,
  type CareerDef,
  type CareerNode,
} from '../../src/career';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { DEFAULT_PROFILE, type Profile } from '../../src/save';
import { createSim, type SimConfig } from '../../src/sim/api';
import { ISOLATED } from './batch';
import { botView, careerRace, REG } from './career-harness';

const DEFS = careerDefs(REG);
const LADDER = bikeLadder(REG, DEFS);
const print = (line: string) => process.stdout.write(`[career-field-ladder] ${line}\n`);

/** The best ladder bike open at a node's global tier (Season 1). */
const bestAt = (def: CareerDef, node: CareerNode) =>
  LADDER[bestOpenRank(LADDER, globalTier(DEFS, def, node.tier))];
/** A tier's boss, and the region's. */
const isBoss = (def: CareerDef, n: CareerNode) => n.id === def.boss || n.id === def.tiers[n.tier]?.boss;

/** A fresh career riding the best bike open at the node, as a player who kept up would. */
function riderAt(def: CareerDef, node: CareerNode): Profile {
  const start = startCareer(DEFS, { ...DEFAULT_PROFILE });
  const best = bestAt(def, node)?.key ?? start.bikes.current;
  return {
    ...start,
    bikes: { ...start.bikes, owned: [...new Set([...start.bikes.owned, best ?? ''])], current: best },
  };
}

describe('a career race carries its field level (the headless career meets the field the player meets)', () => {
  for (const def of DEFS)
    it(`${def.regionName}: every node's race runs at its level's pace, bikes and fight scales`, () => {
      for (const node of def.nodes) {
        const { config, level } = careerRace(def, node, riderAt(def, node), 1);
        if (!level) throw new Error(`${node.id}: no field level`);
        const rivals = config.riders.filter((r) => r.role === 'rival');
        expect(config.event.paceMps, node.id).toBe(level.paceMps);
        expect(config.event.level, node.id).toEqual({
          aggressionScale: level.aggressionScale,
          signatureGapScale: level.signatureGapScale,
        });
        for (const r of rivals) expect(r.bike.contentId, `${node.id} ${r.contentId}`).toBe(level.rivalBike);
        // A free-play race of the same event keeps the event file's own field.
        const free = careerRace(def, node, riderAt(def, node), 1, { free: true }).config;
        expect(free.event.level, node.id).toBeUndefined();
      }
    });
});

describe('the garage is global: every step-up bike rides in every region', () => {
  // Each region's shop sells its own step-up bikes (round 3: "Six bikes"), and a bike bought in one
  // region rides in all of them, the player's and the field's alike. A bike from a pack outside the
  // race's own (a Pacific Northwest bike in a Keys or San Francisco race) once fell back to the
  // rider's own bike, so a player on the Grand Tourer raced San Francisco on the Rustbucket.
  for (const def of DEFS)
    it(`${def.regionName}: the player rides whichever ladder bike is current`, () => {
      const node = def.nodes[0];
      if (!node) throw new Error(def.regionId);
      for (const bike of LADDER) {
        const start = startCareer(DEFS, { ...DEFAULT_PROFILE });
        const profile = { ...start, bikes: { ...start.bikes, owned: [bike.key], current: bike.key } };
        const player = careerRace(def, node, profile, 1).config.riders.find((r) => r.role === 'player');
        expect(player?.bike.contentId, `${bike.key} in ${def.regionId}`).toBe(bike.key);
        expect(player?.bike.topSpeedMps, `${bike.key} in ${def.regionId}`).toBe(bike.topSpeedMps);
      }
    });
});

describe('the rivals ride bikes as good as your best (round 1: "tier 3 rivals ride bikes as good as your best")', () => {
  for (const def of DEFS)
    it(`${def.regionName}: the best open bike from the tier its file names, the rank below before; the law under it`, () => {
      const file = REG.careers[def.key];
      for (const node of def.nodes) {
        const best = bestAt(def, node);
        if (!best) throw new Error(node.id);
        const wantsBest = (file?.tiers[node.tier]?.field?.rivalBike ?? 'best') === 'best';
        const want = wantsBest ? best : (LADDER[Math.max(0, LADDER.indexOf(best) - 1)] ?? best);
        const { config } = careerRace(def, node, riderAt(def, node), 1);
        for (const r of config.riders.filter((x) => x.role === 'rival')) {
          expect(r.bike.contentId, `${node.id} ${r.contentId}`).toBe(want.key);
          expect(r.bike.topSpeedMps, `${node.id} ${r.contentId}`).toBeGreaterThanOrEqual(want.topSpeedMps);
        }
        for (const c of config.riders.filter((x) => x.role === 'cop'))
          expect(c.bike.topSpeedMps, `${node.id} ${c.contentId}`).toBeLessThan(best.topSpeedMps);
      }
      // "As good as your best": the last tier's rivals ride the best open bike.
      expect(file?.tiers.at(-1)?.field?.rivalBike ?? 'best').toBe('best');
    });
});

/** The leading rival's mean speed over ticks 600 to 3000 of a race, the player riding the race. */
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

describe('the field gets faster every tier, measured on one road', () => {
  // One shared road so only the field level differs: the first chapter's first race to the line.
  const first = DEFS[0];
  const road = first?.nodes.find((n) => n.tier === 0 && REG.events[n.event]?.kind === 'classic-race');
  const SEEDS = [1, 2];

  it('every region: the leading rival is faster at each tier than the one before, near its pace', () => {
    if (!first || !road) throw new Error('no first race to the line');
    const lines: string[] = [];
    for (const def of DEFS) {
      let before = 0;
      def.tiers.forEach((tier, t) => {
        const node = def.nodes.find((n) => n.tier === t && !isBoss(def, n));
        if (!node) throw new Error(`${def.regionId} ${tier.id}: no regular event`);
        const level = careerRace(def, node, riderAt(def, node), 1).level;
        if (!level) throw new Error(node.id);
        // The shared road's race with this tier's field level, the player on this tier's best bike.
        // The shared road raced at this tier's level, the player on this tier's best bike.
        const speeds = SEEDS.map((seed) =>
          leadSpeed(careerRace(first, road, riderAt(def, node), seed, { tuning: ISOLATED, level }).config),
        );
        const speed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
        lines.push(
          `${def.regionId} ${tier.id}: pace ${level.paceMps} lead ${speeds.map((s) => s.toFixed(1)).join('/')}`,
        );
        expect(speed, `${def.regionId} ${tier.id} against the tier before`).toBeGreaterThan(before);
        // Near the pace: a band, not today's measurement (the rubber band and traffic-free road).
        expect(speed / level.paceMps, `${def.regionId} ${tier.id}`).toBeGreaterThanOrEqual(0.85);
        expect(speed / level.paceMps, `${def.regionId} ${tier.id}`).toBeLessThanOrEqual(1.12);
        before = speed;
      });
    }
    print(
      `[examined] ${DEFS.length} regions x 4 tiers x ${SEEDS.length} seeds on ${road.event}: ${lines.join('; ')}`,
    );
  }, 300_000);
});

describe('the fights climb gently (round 3: about 10% easier at the first tier, about 20% harder by the last)', () => {
  /** Each rival's knockdown health in the running sim, as a share of its rider file's. */
  function healthShares(config: SimConfig): number[] {
    const snap = createSim(config).snapshot();
    return config.riders.flatMap((r, i) => {
      if (r.role !== 'rival') return [];
      const file =
        (REG.riders[r.contentId] as { stats?: { healthMax?: number } } | undefined)?.stats?.healthMax ?? 100;
      return [(snap.entities[i]?.healthMax ?? 0) / file];
    });
  }
  /** The race's fight scales as "how much harder than a neutral field": health, swings, signature moves. */
  function fight(def: CareerDef, node: CareerNode) {
    const { config } = careerRace(def, node, riderAt(def, node), 1);
    const level = config.event.level ?? { aggressionScale: 1, signatureGapScale: 1 };
    return {
      health: healthShares(config),
      swings: level.aggressionScale,
      // A shorter gap between signature moves is more of them: the rate is its inverse.
      signatures: 1 / level.signatureGapScale,
    };
  }
  const within = (xs: number[], lo: number, hi: number, at: string) =>
    xs.forEach((x) => {
      expect(x, at).toBeGreaterThanOrEqual(lo);
      expect(x, at).toBeLessThanOrEqual(hi);
    });

  for (const def of DEFS)
    it(`${def.regionName}: easier at the first tier, a fifth or so harder by the last, climbing in between`, () => {
      const last = def.tiers.length - 1;
      const firstNodes = def.nodes.filter((n) => n.tier === 0);
      const lastNodes = def.nodes.filter((n) => n.tier === last);
      // Every race of the last tier has regular events besides its boss (T7.1 left this band vacuous
      // for a last tier holding only its boss).
      expect(lastNodes.filter((n) => !isBoss(def, n)).length).toBeGreaterThan(0);
      for (const n of firstNodes) {
        const f = fight(def, n);
        within([...f.health, f.swings, f.signatures], 0.85, 0.97, `${n.id}: easier than a neutral field`);
      }
      for (const n of lastNodes) {
        const f = fight(def, n);
        within([...f.health, f.swings, f.signatures], 1.1, 1.35, `${n.id}: about a fifth harder`);
      }
      // In between, each tier's regular events are at least as hard as the tier before's.
      let before = { health: 0, swings: 0, signatures: 0 };
      def.tiers.forEach((_, t) => {
        const regular = def.nodes.filter((n) => n.tier === t && !isBoss(def, n)).map((n) => fight(def, n));
        const low = {
          health: Math.min(...regular.flatMap((f) => f.health)),
          swings: Math.min(...regular.map((f) => f.swings)),
          signatures: Math.min(...regular.map((f) => f.signatures)),
        };
        for (const k of ['health', 'swings', 'signatures'] as const)
          expect(low[k], `${def.regionId} tier ${t + 1} ${k}`).toBeGreaterThanOrEqual(before[k] - 1e-9);
        before = low;
      });
    });
});
