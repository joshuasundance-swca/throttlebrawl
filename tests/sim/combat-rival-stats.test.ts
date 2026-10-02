/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Playtest 2 (2026-10-02) over the real packs, every region: "Its surprising how long it takes to
// knock people down" ("it should take a few hits even if they are kicks ... still not usually one
// hit") and "Visible personalities" (moderate stat differences). Each rider of each region's race,
// resolved by the app's own buildSimConfig, takes the player's blows through the real combat
// system: the printed table is how many kicks, punches and pipe swings each one takes.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import type { SimRiderDef, SimWeaponDef } from '../../src/sim/api';
import { F, flags, makeHarness, ofType, scriptOf } from '../../src/sim/combat/harness.test-util';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENTS = ['m1-skeleton-sprint', 'region-pnw:pnw-fogline-run', 'region-sf:sf-hill-sprint'];

function field(): { riders: SimRiderDef[]; weapons: readonly SimWeaponDef[] } {
  const riders = new Map<string, SimRiderDef>();
  let weapons: readonly SimWeaponDef[] = [];
  for (const eventId of EVENTS) {
    const c = buildSimConfig(REG, STREAMS.forEvent(REG, eventId), { seed: 1, eventId });
    for (const r of c.riders) if (r.controller.kind !== 'player') riders.set(r.contentId, r);
    weapons = c.weapons;
  }
  return { riders: [...riders.values()], weapons };
}

/** The player's blows with `w` on a fresh `victim`, held alongside, until he is knocked off. */
function blows(victim: SimRiderDef, w: SimWeaponDef): number[] {
  const kick = w.contentId === 'base:kick';
  const held = !w.unarmed;
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'player', ...(held ? { startingWeapon: w.contentId } : {}) },
      {
        s: 100,
        d: 1.2,
        role: victim.faction === 'law' ? 'cop' : 'rival',
        healthMax: victim.healthMax,
        massKg: victim.massKg,
        ...(victim.toughness !== undefined ? { toughness: victim.toughness } : {}),
      },
    ],
    scriptOf({ 0: (t) => (t % 90 === 1 ? flags(kick ? F.attack | F.kick : F.attack) : undefined) }),
    {},
    held ? [w] : [],
  );
  for (let t = 0; t < 90 * 20 && ofType(h.events, 'crash').length === 0; t++) {
    h.run(1);
    const v = h.world.movers[1];
    if (v) v.pos.d = 1.2;
    // A breakable or charged weapon is re-armed: this counts blows, not a weapon's life.
    if (held && ofType(h.events, 'hit').some((e) => e.data['spent'] === true)) break;
  }
  return ofType(h.events, 'hit')
    .filter((e) => e.actor === 0)
    .map((e) => Number(e.data['damage']));
}

describe('playtest 2: knockdowns and fight stats over the real packs', () => {
  const { riders, weapons } = field();
  const weapon = (id: string) => weapons.find((w) => w.contentId === id);

  it('every rival carries moderate fight stats (0.85 to 1.25); cops and the player keep 1', () => {
    const rivals = riders.filter((r) => r.role === 'rival');
    expect(rivals.length).toBeGreaterThanOrEqual(8);
    for (const r of rivals) {
      expect(r.toughness, r.contentId).toBeGreaterThanOrEqual(0.85);
      expect(r.toughness, r.contentId).toBeLessThanOrEqual(1.25);
      expect(r.power, r.contentId).toBeGreaterThanOrEqual(0.85);
      expect(r.power, r.contentId).toBeLessThanOrEqual(1.25);
    }
    // At least one tough and one fragile rider, and one strong and one weak: visible differences.
    expect(rivals.some((r) => (r.toughness ?? 1) > 1.1)).toBe(true);
    expect(rivals.some((r) => (r.toughness ?? 1) < 1)).toBe(true);
    expect(rivals.some((r) => (r.power ?? 1) > 1.1)).toBe(true);
    expect(rivals.some((r) => (r.power ?? 1) < 1)).toBe(true);
    for (const r of riders.filter((x) => x.role === 'cop')) {
      expect(r.toughness, r.contentId).toBe(1);
      expect(r.power, r.contentId).toBe(1);
    }
  });

  it('the player knocks each rider off in a few blows, never one (printed)', () => {
    const kick = weapon('base:kick');
    const punch = weapon('base:punch');
    const pipe = weapon('base:lead-pipe');
    if (!kick || !punch || !pipe) throw new Error('the base weapons are missing');
    const lines: string[] = [];
    const kicks: number[] = [];
    for (const r of riders) {
      const k = blows(r, kick).length;
      const p = blows(r, punch).length;
      const s = blows(r, pipe).length;
      kicks.push(k);
      lines.push(
        `${r.contentId} (${r.healthMax} hp, toughness ${r.toughness ?? 1}): ${k} kicks, ${p} punches, ${s} pipe`,
      );
      expect(k, `${r.contentId}: kicks`).toBeGreaterThanOrEqual(2);
      expect(k, `${r.contentId}: kicks`).toBeLessThanOrEqual(5);
      expect(p, `${r.contentId}: punches`).toBeGreaterThanOrEqual(4);
      expect(p, `${r.contentId}: punches`).toBeLessThanOrEqual(8);
      expect(s, `${r.contentId}: pipe`).toBeGreaterThanOrEqual(2);
      expect(s, `${r.contentId}: pipe`).toBeLessThanOrEqual(3);
    }
    process.stdout.write(`[knockdowns] ${lines.join('; ')}\n`);
    // About 3 kicks for a typical rider.
    const sorted = [...kicks].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBe(3);
  });

  it('no single blow of any weapon knocks a fresh rider off', () => {
    for (const r of riders) {
      for (const w of weapons) {
        const first = blows(r, w)[0];
        if (first === undefined) continue; // a weapon this harness cannot land (none today)
        expect(first, `${w.contentId} on ${r.contentId}`).toBeLessThan(r.healthMax);
      }
    }
  });
});
