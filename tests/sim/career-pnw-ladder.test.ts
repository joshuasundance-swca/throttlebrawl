/// <reference types="vite/client" />
// The Pacific Northwest circuit on playtest 3's ladder (T10.2; the maintainer, 2026-10-03: "The
// progression doesn't feel right. I won a few easy races and then bought the fastest bike. No
// struggle, no increasing difficulty"; round 3: "Six bikes", "In order", "Gentle climb"). The rules
// of docs/product-spec.md (Cash, Rivals, Bikes) and docs/content-packs.md (Career), checked on the
// region's own files: it is the second chapter, so its four tiers are global tiers 5 to 8, each
// tier names its boss and the field it asks, the purse and the rivals' pace follow the global tier,
// and the shop sells the Grand Tourer and the Supersport (two of the six bikes, one every second
// tier) with their models in the pack. Data only: no race is run here; the races are
// tests/sim/career-headless-pnw.test.ts. The same rules hold for the other regions' careers in
// their own tests; this file keeps this region's bikes and tiers honest on its own.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bare, careerDefs, eventPlan, type CareerDef } from '../../src/career';
import { packOf } from '../../src/content';
import { REG } from './career-harness';

const PACKS = fileURLToPath(new URL('../../packs/', import.meta.url));
const TIERS_PER_REGION = 4;
/** What a clear step up means: faster than the bike before by more than the rubber band's 6 %. */
const STEP = 1.06;

/** Rounds to $50, a tie going to the even multiple (the spec's table is built that way). */
const to50 = (x: number): number => {
  const q = x / 50;
  const down = Math.floor(q);
  const tie = q - down === 0.5;
  return 50 * (tie ? (down % 2 === 0 ? down : down + 1) : Math.round(q));
};
/** W(g): the purse of a regular event at global tier g (1 to 12). */
const purse = (g: number): number => to50(900 * 1.22 ** (g - 1));

const def: CareerDef | undefined = careerDefs(REG).find((d) => d.regionId === 'pacific-northwest');
const file = def ? REG.careers[def.key] : undefined;
if (!def || !file) throw new Error('no Pacific Northwest career');
const career = def;
const tiers = file.tiers;
/** The global tier of region tier index t: the earlier chapters' tiers, then this one's. */
const globalTier = (t: number) => (career.chapter - 1) * TIERS_PER_REGION + t + 1;
const top = (bike: string) => REG.bikes[bike]?.handling.topSpeedMps ?? 0;
const bossOf = (t: number) => tiers[t]?.boss;
const regular = (t: number) => career.nodes.filter((n) => n.tier === t && n.id !== bossOf(t));
const requiredBonus = (plan: ReturnType<typeof eventPlan>): number =>
  plan.objectives.filter((o) => o.required).reduce((sum, o) => sum + o.rewardCash, 0);

describe('the Pacific Northwest circuit on the tier-boss ladder', () => {
  it('is the second chapter: global tiers 5 to 8', () => {
    expect(globalTier(0)).toBe(5);
    expect(globalTier(TIERS_PER_REGION - 1)).toBe(8);
  });

  it("names every tier's boss, a grudge match, and asks two wins of the tier's other events to open it", () => {
    expect(tiers.length).toBe(TIERS_PER_REGION);
    tiers.forEach((tier, t) => {
      const boss = career.nodes.find((n) => n.id === tier.boss);
      expect(boss?.tier, `${tier.id}'s boss`).toBe(t);
      expect(eventPlan(REG, boss?.event ?? '').kind, `${tier.id}'s boss`).toBe('grudge-match');
      expect(tier.advance.requiredWins, `${tier.id}'s gate`).toBe(2);
      expect(regular(t).length, `${tier.id}'s regular events`).toBeGreaterThanOrEqual(2);
    });
    expect(tiers.at(-1)?.boss).toBe(career.boss);
  });

  it('every tier states the field it asks: faster, harder, rarer signature gaps, gently stiffer fights', () => {
    const fields = tiers.map((t) => t.field);
    const series = (pick: (f: NonNullable<(typeof fields)[number]>) => number | undefined) =>
      fields.map((f) => (f ? (pick(f) ?? NaN) : NaN));
    for (const rising of [
      series((f) => f.paceShare),
      series((f) => f.aggression),
      series((f) => f.health),
      series((f) => f.power),
    ])
      rising.forEach((v, i) => {
        expect(v).toBeGreaterThan(0);
        if (i > 0) expect(v).toBeGreaterThan(rising[i - 1] ?? Infinity);
      });
    const gaps = series((f) => f.signatureGap);
    gaps.forEach((v, i) => i > 0 && expect(v).toBeLessThan(gaps[i - 1] ?? 0));
    // "Gentle climb": about 10 % easier to knock down at the first tier, about 20 % harder by the last.
    expect(fields[0]?.health).toBeCloseTo(0.9, 5);
    expect(fields.at(-1)?.health).toBeCloseTo(1.2, 5);
    // "Tier 3 rivals ride bikes as good as your best": the best open bike from the third tier on.
    expect(fields.map((f) => f?.rivalBike)).toEqual(['step-down', 'step-down', 'best', 'best']);
  });

  it("every event's purse follows its global tier: a win 1 W, a tier boss 1.5 W, the region boss 2.5 W", () => {
    career.nodes.forEach((node) => {
      const plan = eventPlan(REG, node.event);
      const g = globalTier(node.tier);
      const boss = bossOf(node.tier) === node.id;
      const regionBoss = node.id === career.boss;
      const where = `${node.id} at global tier ${g}`;
      if (regionBoss) expect(requiredBonus(plan), where).toBe(to50(2.5 * purse(g)));
      else if (boss) expect(requiredBonus(plan), where).toBe(to50(1.5 * purse(g)));
      else if (plan.kind === 'classic-race') {
        // A race to the line pays by place; nothing required carries a bonus.
        expect(plan.byPlaceCash[0], where).toBe(purse(g));
        expect(requiredBonus(plan), where).toBe(0);
      } else expect(requiredBonus(plan), where).toBe(purse(g));
      // Whatever is optional pays a fixed share of the purse: 0.15 W.
      for (const o of plan.objectives.filter((x) => !x.required))
        expect(o.rewardCash, `${where}: ${o.id}`).toBe(to50(0.15 * purse(g)));
      const rewards = REG.events[node.event]?.rewards;
      expect(rewards?.perTakedownCash, where).toBe(150 + 25 * (g - 1) + (boss || regionBoss ? 100 : 0));
    });
  });

  it("the rivals' pace is the tier's share of the best step-up bike open there, a boss a little more", () => {
    // The best open bike: the Keys' last step-up bike (the Streetfighter 750, rank 3 of the six) is
    // open before the first tier, and this shop's bikes open as their tiers do.
    const best = (t: number): number =>
      Math.max(
        top('base:streetfighter-750'),
        ...career.shop
          .filter((s) => s.unlockTier <= t && (REG.bikes[s.bike]?.tags ?? []).includes('step-up'))
          .map((s) => top(s.bike)),
      );
    career.nodes.forEach((node) => {
      const share = tiers[node.tier]?.field?.paceShare ?? NaN;
      const bump = node.id === career.boss ? 0.04 : bossOf(node.tier) === node.id ? 0.02 : 0;
      const pace = REG.events[node.event]?.field.paceMps ?? NaN;
      expect(pace, node.id).toBeCloseTo((share + bump) * best(node.tier), 1);
    });
    // And the pace climbs: each tier's slowest regular event is faster than the one before's fastest.
    const pace = (id: string) => REG.events[id]?.field.paceMps ?? 0;
    for (let t = 1; t < TIERS_PER_REGION; t++)
      expect(Math.min(...regular(t).map((n) => pace(n.event))), `tier ${t + 1}`).toBeGreaterThan(
        Math.max(...regular(t - 1).map((n) => pace(n.event))),
      );
  });
});

describe("the Pacific Northwest shop and the six bikes' ladder", () => {
  const stepUps = career.shop
    .filter((s) => (REG.bikes[s.bike]?.tags ?? []).includes('step-up'))
    .sort((a, b) => a.unlockTier - b.unlockTier);

  it('sells the starter, a joke ride and a new step-up bike every second tier, pricier and a clear step up', () => {
    expect(career.shop.find((s) => s.bike === career.startingBike)?.priceCash).toBe(0);
    // Region tiers 2 and 4 are indexes 1 and 3: "a new bike every second tier".
    expect(stepUps.map((s) => s.unlockTier)).toEqual([1, 3]);
    let before = { price: 0, speed: top('base:streetfighter-750') };
    for (const s of stepUps) {
      expect(s.priceCash, `${s.bike}'s price`).toBeGreaterThan(before.price);
      expect(top(s.bike), `${s.bike}'s top speed`).toBeGreaterThan(before.speed * STEP);
      before = { price: s.priceCash, speed: top(s.bike) };
    }
  });

  it("draws every bike it sells from `models/bikes/<id>` in the bike's own pack", () => {
    for (const s of career.shop) {
      const model = `${PACKS}${packOf(s.bike)}/assets/models/bikes/${bare(s.bike)}.glb`;
      expect(existsSync(model), `${s.bike}'s model`).toBe(true);
    }
  });

  it('is the only shop for the bikes it sells: each is for sale in one region', () => {
    for (const other of careerDefs(REG).filter((d) => d.key !== career.key))
      for (const s of career.shop.filter((x) => x.priceCash > 0))
        expect(
          other.shop.map((x) => x.bike),
          `${s.bike} is also sold in ${other.regionName}`,
        ).not.toContain(s.bike);
  });

  it('its bikes sit on the one ladder between the last Keys bike and the last bike overall, each a clear step up', () => {
    // Rank 3, then this region's two, then rank 6 (San Francisco's), by the rubber band's 6 %.
    const ladder = ['base:streetfighter-750', ...stepUps.map((s) => s.bike), 'base:superbike-1000'];
    expect(ladder.length, 'this shop sells step-up bikes').toBeGreaterThan(2);
    for (let i = 1; i < ladder.length; i++)
      expect(top(ladder[i] ?? ''), `${ladder[i]} against ${ladder[i - 1]}`).toBeGreaterThan(
        top(ladder[i - 1] ?? '') * STEP,
      );
  });
});
