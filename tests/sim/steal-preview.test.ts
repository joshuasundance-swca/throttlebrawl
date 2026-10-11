/// <reference types="vite/client" />
// docs/milestones/steal-cue.md: acceptance reads each released weapon through the game's resolver.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { combatState, combatView, stealPreview, THROW_SNATCH_M } from '../../src/sim/combat';
import { F, flags, makeHarness } from '../../src/sim/combat/harness.test-util';
import type { SimWeaponDef } from '../../src/sim/types';

const registry = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const streams = createStreamCache();
const eventId = 'base:m1-skeleton-sprint';
const resolved = buildSimConfig(registry, streams.forEvent(registry, eventId), { seed: 7, eventId });
const weapons = resolved.weapons.filter((w) => !w.unarmed && w.steal);

/** Posttick fixture with a real held-weapon swing; next press tests the resolved scaled age. */
function windup(w: SimWeaponDef, age: number, scale: number, side: number, ds = 0, dd = 0.5) {
  let press = false;
  const h = makeHarness(
    [
      { s: 100, d: 0, startingWeapon: w.contentId },
      { s: 100 + ds, d: side * dd, role: 'player' },
    ],
    // Holder aims away so an after-window control is not confounded by its landed hit/stagger.
    (tick, id) =>
      id === 0 && tick === 0
        ? flags(F.attack | (side === 1 ? F.attackSideLeft : F.attackSideRight))
        : id === 1 && press
          ? flags(F.attack)
          : undefined,
    {},
    [w],
  );
  h.world.timeScale = scale;
  h.run(Math.round(age / scale));
  return {
    h,
    press: () => {
      press = true;
      h.run(1);
      return h.events.filter((e) => e.type === 'weaponGrab' && e.data['source'] === 'steal');
    },
  };
}

describe('resolved weapon steal preview', () => {
  it('the released pack supplies stealable held weapons for these checks', () => {
    expect(weapons.length).toBeGreaterThan(0);
    expect(weapons.some((w) => w.behaviour === 'throw.burst')).toBe(true);
    expect(weapons.some((w) => w.charges != null)).toBe(true);
  });

  for (const w of weapons) {
    it(`${w.contentId}: both inclusive endpoints, both sides and scaled time match actual ownership`, () => {
      for (const scale of [1, 0.5]) {
        for (const side of [-1, 1]) {
          for (const age of [w.steal!.startTick, w.steal!.endTick]) {
            const { h, press } = windup(w, age, scale, side);
            const st = combatState(h.world);
            const pid = st.heldPickup[0] ?? -1;
            // Finite uses remain attached to this pickup across the steal.
            if (w.charges != null) st.pickupCharges[pid] = Math.max(1, w.charges - 1);
            if (w.durabilityHits != null) st.pickupHits[pid] = Math.max(1, w.durabilityHits - 1);
            const charges = st.pickupCharges[pid];
            const hits = st.pickupHits[pid];
            const cause = st.cause[0];
            expect(stealPreview(h.world, h.config, 1)).toBe(0);
            const transfers = press();
            expect(transfers).toHaveLength(1);
            expect(transfers[0]).toMatchObject({
              actor: 1,
              target: 0,
              causeId: cause,
              data: { weapon: w.contentId, source: 'steal', windupTick: age },
            });
            expect(st.heldPickup[1]).toBe(pid);
            expect(st.pickupHolder[pid]).toBe(1);
            expect(st.pickupCharges[pid]).toBe(charges);
            expect(st.pickupHits[pid]).toBe(hits);
            expect(combatView(h.world, 0).heldWeapon).toBeNull();
            expect(combatView(h.world, 1).heldWeapon).toBe(w.contentId);
          }
          for (const age of [w.steal!.startTick - scale, w.steal!.endTick + scale]) {
            const { h, press } = windup(w, age, scale, side);
            expect(stealPreview(h.world, h.config, 1)).toBe(-1);
            expect(press()).toHaveLength(0);
            expect(combatView(h.world, 0).heldWeapon).toBe(
              w.behaviour === 'throw.burst' && age > w.windupTicks ? null : w.contentId,
            );
          }
        }
      }
    });

    it(`${w.contentId}: its actual snatch box accepts both edges and excludes each outside dimension`, () => {
      const thrown = w.behaviour === 'throw.burst';
      const boxS = thrown ? Math.min(w.reachSM, THROW_SNATCH_M) : w.reachSM;
      const boxD = thrown ? Math.min(w.reachDM, THROW_SNATCH_M) : w.reachDM;
      for (const side of [-1, 1]) {
        for (const [ds, dd, eligible] of [
          [-boxS, boxD, true],
          [boxS, boxD, true],
          [-boxS - 0.01, boxD, false],
          [boxS + 0.01, boxD, false],
          [0, boxD + 0.01, false],
        ] as const) {
          const { h, press } = windup(w, w.steal!.startTick, 1, side, ds, dd);
          // Use an origin where the boundary subtraction is exact. At s=100, adding a 2.4 m
          // reach produces a slightly larger floating-point delta, outside the unchanged rule.
          h.world.movers[0]!.pos.s = boxS;
          h.world.movers[1]!.pos.s = boxS + ds;
          expect(stealPreview(h.world, h.config, 1)).toBe(eligible ? 0 : -1);
          expect(press()).toHaveLength(eligible ? 1 : 0);
        }
      }
    });
  }
});
