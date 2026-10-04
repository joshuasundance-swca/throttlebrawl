/// <reference types="vite/client" />
// The career's ladder as content (playtest 3; the maintainer, 2026-10-03: "The progression doesn't
// feel right. I won a few easy races and then bought the fastest bike. No struggle, no increasing
// difficulty"; round 3: "Six bikes", "Gentle climb"). The rules of docs/product-spec.md (Cash,
// Rivals, Bikes) checked on every career file that names its tier bosses, so each region's content
// PR meets them as it moves over: four tiers of three regular events and the tier's boss, the purse
// following the global tier, the rivals' pace and field climbing tier by tier, and each bike a
// career sells a clear step up with its model in the pack. Data only: no race is run here; the
// races are tests/sim/career-headless-*.test.ts.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, type CareerDef } from '../../src/career';
import { packOf, registryFromGlob } from '../../src/content';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const PACKS = fileURLToPath(new URL('../../packs/', import.meta.url));

/**
 * Round to $50, a tie going to the even multiple (progression.md, section 5: 1.5 W at tier 3 is
 * 2025, and the table prints 2000).
 */
const to50 = (x: number): number => {
  const q = x / 50;
  const down = Math.floor(q);
  const tie = q - down === 0.5;
  return 50 * (tie ? (down % 2 === 0 ? down : down + 1) : Math.round(q));
};
/** W(g): the purse of a regular event at global tier g (1 to 12). */
const purse = (g: number): number => to50(900 * 1.22 ** (g - 1));
const TIERS_PER_REGION = 4;

// Only the careers that name their tier bosses are on the new ladder; the others are checked as
// they move over (each region's content is its own PR).
const DEFS = careerDefs(REG).filter((d) =>
  (REG.careers[d.key]?.tiers ?? []).every((t) => typeof t.boss === 'string'),
);

/** The regular nodes of a tier (every node but its boss), in map order. */
function regularNodes(def: CareerDef, t: number) {
  const bossId = REG.careers[def.key]?.tiers[t]?.boss;
  return def.nodes.filter((n) => n.tier === t && n.id !== bossId);
}

const requiredBonus = (plan: ReturnType<typeof eventPlan>): number =>
  plan.objectives.filter((o) => o.required).reduce((sum, o) => sum + o.rewardCash, 0);

it('at least one career is on the tier-boss ladder, the Keys first', () => {
  expect(DEFS.length).toBeGreaterThanOrEqual(1);
  expect(DEFS[0]?.regionId).toBe('florida-keys');
});

for (const def of DEFS) {
  describe(`${def.regionName}'s ladder`, () => {
    const file = REG.careers[def.key];
    const tiers = file?.tiers ?? [];
    /** The global tier of region tier index t: the earlier chapters' tiers, then this one's. */
    const globalTier = (t: number) => (def.chapter - 1) * TIERS_PER_REGION + t + 1;

    it('four tiers of two or three regular events and the tier boss, two wins opening the boss', () => {
      // Three regular events a tier; a region holds two in a tier until its drift events land.
      expect(tiers.length).toBe(TIERS_PER_REGION);
      tiers.forEach((tier, t) => {
        const regular = regularNodes(def, t).length;
        expect(regular, `${tier.id}'s regular events`).toBeGreaterThanOrEqual(2);
        expect(regular, `${tier.id}'s regular events`).toBeLessThanOrEqual(3);
        expect(tier.advance.requiredWins, `${tier.id}'s gate`).toBe(2);
        const boss = def.nodes.find((n) => n.id === tier.boss);
        expect(boss?.tier, `${tier.id}'s boss`).toBe(t);
        expect(eventPlan(REG, boss?.event ?? '').kind, `${tier.id}'s boss`).toBe('grudge-match');
      });
      expect(tiers.at(-1)?.boss).toBe(def.boss);
    });

    it("every event's purse follows its global tier: place or bonus 1 W, a tier boss 1.5 W, the region boss 2.5 W", () => {
      def.nodes.forEach((node) => {
        const plan = eventPlan(REG, node.event);
        const g = globalTier(node.tier);
        const boss = tiers[node.tier]?.boss === node.id;
        const regionBoss = node.id === def.boss;
        const where = `${node.id} at global tier ${g}`;
        if (regionBoss) expect(requiredBonus(plan), where).toBe(to50(2.5 * purse(g)));
        else if (boss) expect(requiredBonus(plan), where).toBe(to50(1.5 * purse(g)));
        else if (plan.kind === 'classic-race') {
          // A race to the line pays by place; nothing required carries a bonus.
          expect(plan.byPlaceCash[0], where).toBe(purse(g));
          expect(requiredBonus(plan), where).toBe(0);
        } else expect(requiredBonus(plan), where).toBe(purse(g));
        // The optional objectives pay a fixed share of the purse: 0.15 W.
        for (const o of plan.objectives.filter((x) => !x.required))
          expect(o.rewardCash, `${where}: ${o.id}`).toBe(to50(0.15 * purse(g)));
        const rewards = REG.events[node.event]?.rewards;
        expect(rewards?.perTakedownCash, where).toBe(150 + 25 * (g - 1) + (boss || regionBoss ? 100 : 0));
      });
    });

    it('the rivals climb: each tier is faster than the one before, a boss at least its tier, and the field stiffens', () => {
      const pace = (id: string) => REG.events[id]?.field.paceMps ?? 0;
      const slowest = (t: number) => Math.min(...regularNodes(def, t).map((n) => pace(n.event)));
      const fastest = (t: number) => Math.max(...regularNodes(def, t).map((n) => pace(n.event)));
      for (let t = 1; t < TIERS_PER_REGION; t++)
        expect(slowest(t), `tier ${t + 1} against tier ${t}`).toBeGreaterThan(fastest(t - 1));
      def.nodes
        .filter((n) => n.id === tiers[n.tier]?.boss || n.id === def.boss)
        .forEach((n) => expect(pace(n.event), n.id).toBeGreaterThanOrEqual(fastest(n.tier)));
      // The tier's field level (docs/product-spec.md, Rivals): pace share, aggression, health and
      // power rise, the gap between signature moves falls, and from tier three the rivals ride the
      // best open bike. "Gentle climb": about 10 % easier to knock down at the first tier, about
      // 20 % harder by the last.
      const fields = tiers.map((t) => t.field);
      const rising = (pick: (f: NonNullable<(typeof fields)[number]>) => number | undefined) =>
        fields.map((f) => (f ? (pick(f) ?? NaN) : NaN));
      for (const series of [
        rising((f) => f.paceShare),
        rising((f) => f.aggression),
        rising((f) => f.health),
        rising((f) => f.power),
      ])
        series.forEach((v, i) => {
          expect(v).toBeGreaterThan(0);
          if (i > 0) expect(v).toBeGreaterThan(series[i - 1] ?? Infinity);
        });
      const gaps = rising((f) => f.signatureGap);
      gaps.forEach((v, i) => i > 0 && expect(v).toBeLessThan(gaps[i - 1] ?? 0));
      expect(fields[0]?.health).toBeCloseTo(0.9, 5);
      expect(fields.at(-1)?.health).toBeCloseTo(1.2, 5);
      expect(fields.map((f) => f?.rivalBike)).toEqual(['step-down', 'step-down', 'best', 'best']);
    });

    it('the shop sells the starter, then each step-up bike a clear step up and pricier, its model in the pack', () => {
      const shop = def.shop.filter((s) => s.priceCash > 0);
      const stepUps = shop
        .filter((s) => (REG.bikes[s.bike]?.tags ?? []).includes('step-up'))
        .sort((a, b) => a.unlockTier - b.unlockTier || a.priceCash - b.priceCash);
      expect(stepUps.length).toBeGreaterThanOrEqual(1);
      const top = (key: string) => REG.bikes[key]?.handling.topSpeedMps ?? 0;
      stepUps.forEach((s, i) => {
        if (i === 0) return;
        const before = stepUps[i - 1];
        expect(s.priceCash, s.bike).toBeGreaterThan(before?.priceCash ?? Infinity);
        expect(top(s.bike), s.bike).toBeGreaterThan(top(before?.bike ?? '') * 1.06);
      });
      // Every bike the shop sells is drawn from `models/bikes/<id>` in its pack.
      for (const s of def.shop) {
        const model = `${PACKS}${packOf(s.bike)}/assets/models/bikes/${s.bike.slice(s.bike.indexOf(':') + 1)}.glb`;
        expect(existsSync(model), `${s.bike}'s model`).toBe(true);
      }
    });
  });
}
