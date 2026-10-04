/// <reference types="vite/client" />
// Playtest 3's climb, checked against the career files as shipped (the maintainer, 2026-10-03: "The
// progression doesn't feel right. I won a few easy races and then bought the fastest bike. No
// struggle, no increasing difficulty"; round 3, "Gentle climb": rivals about 10% easier to knock
// down at a region's first tier and about 20% harder by its last; "In order": the Keys, then the
// Pacific Northwest, then San Francisco). Each rule reads the packs and holds for every career that
// names its tier bosses, so a lane that moves its region over is held to the same rules.
import { describe, expect, it } from 'vitest';
import { careerDefs, eventPlan, type CareerDef } from '../../src/career';
import { REG } from './career-harness';

const DEFS = careerDefs(REG);

/** The career file behind a def (its tiers keep their boss and field level). */
const fileOf = (def: CareerDef) => {
  const c = REG.careers[def.key];
  if (!c) throw new Error(`no career file ${def.key}`);
  return c;
};

/** Careers on the tier-boss format: every tier names its boss. */
const onFormat = (def: CareerDef): boolean => fileOf(def).tiers.every((t) => t.boss !== undefined);

/** What winning a race pays: first place's prize and the required objectives' bonuses. */
function winPay(key: string): number {
  const plan = eventPlan(REG, key);
  return (
    (plan.byPlaceCash[0] ?? 0) +
    plan.objectives.filter((o) => o.required).reduce((s, o) => s + o.rewardCash, 0)
  );
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe("the San Francisco circuit on playtest 3's format", () => {
  const def = DEFS.find((d) => d.regionId === 'san-francisco');

  it('names a boss and a field level for every tier, and the last tier has the region boss', () => {
    expect(def).toBeDefined();
    if (!def) return;
    const tiers = fileOf(def).tiers;
    expect(tiers.every((t) => t.boss !== undefined)).toBe(true);
    expect(tiers.every((t) => t.field !== undefined)).toBe(true);
    expect(tiers.at(-1)?.boss).toBe(def.boss);
  });

  it('sells a step-up bike, and it costs more than a win pays at the tier it opens in', () => {
    if (!def) throw new Error('no San Francisco career');
    const stepUps = def.shop.filter((s) => (REG.bikes[s.bike]?.tags ?? []).includes('step-up'));
    expect(stepUps.length).toBeGreaterThan(0);
    // "Each new bike takes about 3-4 races" (the balance test measures it; this is the floor): no
    // step-up bike is one win away.
    for (const s of stepUps) {
      const pay = Math.max(...def.nodes.filter((n) => n.tier === s.unlockTier).map((n) => winPay(n.event)));
      expect(s.priceCash, s.bike).toBeGreaterThan(pay);
    }
  });
});

describe('every career on the tier-boss format', () => {
  for (const def of DEFS.filter(onFormat)) {
    describe(def.regionName, () => {
      const file = fileOf(def);
      const fields = file.tiers.map((t) => t.field ?? {});

      it('each tier holds its boss last, after the wins that open it', () => {
        file.tiers.forEach((t, i) => {
          const nodes = def.nodes.filter((n) => n.tier === i);
          expect(nodes.at(-1)?.id, t.id).toBe(t.boss);
          expect(nodes.length - 1, `${t.id} regular nodes`).toBeGreaterThanOrEqual(t.advance.requiredWins);
        });
      });

      it('the field climbs: faster, harder, hitting harder and rarer signature gaps, tier by tier', () => {
        const climbs = (pick: (f: (typeof fields)[number]) => number | undefined, dir: 1 | -1) => {
          const xs = fields.map(pick);
          xs.forEach((x, i) => {
            expect(x, `tier ${i + 1} sets it`).toBeDefined();
            const before = xs[i - 1];
            if (before !== undefined && x !== undefined) expect((x - before) * dir).toBeGreaterThanOrEqual(0);
          });
          return xs;
        };
        climbs((f) => f.paceShare, 1);
        climbs((f) => f.aggression, 1);
        climbs((f) => f.health, 1);
        climbs((f) => f.power, 1);
        climbs((f) => f.signatureGap, -1);
        // The rivals ride the best open bike from some tier on, and the last tier is there.
        const best = fields.map((f) => f.rivalBike === 'best');
        expect(best.at(-1)).toBe(true);
        expect(best.indexOf(true)).toBe(best.lastIndexOf(false) + 1);
      });

      it('a gentle climb: easier to knock down at the first tier, a fifth harder by the last', () => {
        // The maintainer's "about 10% easier ... about 20% harder", with room to tune.
        for (const key of ['health', 'power'] as const) {
          const first = fields[0]?.[key] ?? 1;
          const last = fields.at(-1)?.[key] ?? 1;
          expect(first, `first tier ${key}`).toBeGreaterThanOrEqual(0.85);
          expect(first, `first tier ${key}`).toBeLessThanOrEqual(0.95);
          expect(last, `last tier ${key}`).toBeGreaterThanOrEqual(1.1);
          expect(last, `last tier ${key}`).toBeLessThanOrEqual(1.3);
        }
      });

      it('pay climbs with the tiers, and a tier boss pays more than its tier’s other races', () => {
        const regular = file.tiers.map((t, i) =>
          def.nodes.filter((n) => n.tier === i && n.id !== t.boss).map((n) => winPay(n.event)),
        );
        const means = regular.map(mean);
        means.forEach((m, i) => {
          const before = means[i - 1];
          if (before !== undefined)
            expect(m, `tier ${i + 1} pays more than tier ${i}`).toBeGreaterThan(before);
        });
        file.tiers.forEach((t, i) => {
          const boss = def.nodes.find((n) => n.id === t.boss);
          expect(winPay(boss?.event ?? ''), `${t.id} boss`).toBeGreaterThan(Math.max(...(regular[i] ?? [0])));
        });
      });
    });
  }
});
