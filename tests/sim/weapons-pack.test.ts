// weapons-2's acceptance over the real base pack (docs/milestones/M4.md, weapons-2; a head start):
// every weapon's steal window lints inside its wind-up, a scripted steal works for each stealable
// weapon, and a weapon added as data only (a test fixture, run through the real pack loader)
// plays with no code change. `simWeapon` is the lane's oracle for how buildSimConfig should map a
// weapon file once the app lane wires the new SimWeaponDef fields (the report's follow-up).
//
// The reference below gives this Node-side file the Vite client types (`import.meta.glob`), which
// the base-pack loader uses.
/// <reference types="vite/client" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, loadBasePack, stealTicks } from '../../src/content';
import { secondsToTicks } from '../../src/core';
import type { SimWeaponDef } from '../../src/sim/api';
import { F, flags, makeHarness, ofType, scriptOf } from '../../src/sim/combat/harness.test-util';
import { behaviourOf, combatView, WEAPON_BEHAVIOURS } from '../../src/sim/combat';

const FIXTURE: unknown = JSON.parse(
  readFileSync(new URL('./fixtures/weapon-pool-noodle.json', import.meta.url), 'utf8'),
);

const print = (line: string) => process.stdout.write(`[weapons-2] ${line}\n`);

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A weapon file as the sim should see it: the M1 fields as buildSimConfig maps them, plus M4's. */
function simWeapon(w: Json): SimWeaponDef {
  const reach = obj(w['reach']);
  const knock = obj(w['knockback']);
  const steal = obj(w['steal']);
  const uses = obj(w['uses']);
  const stun = (Array.isArray(w['effects']) ? w['effects'] : []).map(obj).find((e) => e['kind'] === 'stun');
  const out: SimWeaponDef = {
    contentId: `base:${String(w['id'])}`,
    unarmed: w['unarmed'] === true,
    reachSM: Number(reach['sM']),
    reachDM: Number(reach['dM']),
    windupTicks: secondsToTicks(Number(w['windupS'])),
    activeTicks: secondsToTicks(Number(w['activeS'])),
    recoveryTicks: secondsToTicks(Number(w['recoveryS'])),
    cooldownTicks: num(w['cooldownS']) ? secondsToTicks(Number(w['cooldownS'])) : 0,
    damage: Number(w['damage']),
    hitStopMs: num(w['hitStopMs']) ?? 0,
    knockbackMps: num(knock['lateralMps']) ?? 0,
    staggerTicks: num(knock['staggerS']) ? secondsToTicks(Number(knock['staggerS'])) : 0,
    steal:
      steal['allowed'] === true
        ? {
            startTick: Math.round(Number(steal['windowStartS']) * 60),
            endTick: Math.round(Number(steal['windowEndS']) * 60),
          }
        : null,
    behaviour: String(w['behaviour']),
    charges: num(uses['charges']),
    durabilityHits: num(uses['durabilityHits']),
  };
  const stunS = num(stun?.['durationS']);
  if (stunS) out.stunTicks = secondsToTicks(stunS);
  const weight = num(obj(w['spawn'])['roadsideWeight']);
  if (weight !== null) out.roadsideWeight = weight;
  return out;
}

const reg = loadBasePack({ includeDrafts: true });
const weapons = Object.values(reg.weapons) as unknown as Json[];
const armed = weapons.filter((w) => w['unarmed'] !== true);

describe('weapons-2: every v1 weapon is in the base pack, as data', () => {
  it('has the decided list: club or pipe, chain, wasteland junk, the baton and the taser', () => {
    const ids = armed.map((w) => String(w['id'])).sort();
    print(`armed weapons in the base pack (drafts included): ${ids.join(', ')}`);
    expect(ids).toEqual(
      expect.arrayContaining([
        'lead-pipe',
        'driftwood-club',
        'bike-chain',
        'kevins-briefcase',
        'campaign-sign',
        'baton',
        'taser',
      ]),
    );
    const cats = new Set(armed.map((w) => w['category']));
    for (const c of ['blunt', 'chain', 'junk', 'shock']) expect(cats.has(c), c).toBe(true);
    // Every behaviour named in the pack is registered, so none silently falls back to the swing.
    for (const w of weapons) expect(WEAPON_BEHAVIOURS as readonly unknown[]).toContain(w['behaviour']);
  });

  it('the cops’ weapons never lie on the road; the taser has charges and a stun', () => {
    const baton = simWeapon(armed.find((w) => w['id'] === 'baton') ?? {});
    const taser = simWeapon(armed.find((w) => w['id'] === 'taser') ?? {});
    expect([baton.roadsideWeight, taser.roadsideWeight]).toEqual([0, 0]);
    expect(behaviourOf(taser)).toBe('taser.stun');
    expect(taser.charges).toBe(6);
    expect(taser.stunTicks).toBe(54);
  });

  it('every weapon’s steal window sits inside its wind-up, in ticks (the lint rule, re-derived)', () => {
    let checked = 0;
    for (const w of armed) {
      const steal = obj(w['steal']);
      if (steal['allowed'] !== true) continue;
      const t = stealTicks(Number(steal['windowStartS']), Number(steal['windowEndS']), Number(w['windupS']));
      expect(t.start, String(w['id'])).toBeGreaterThanOrEqual(0);
      expect(t.start, String(w['id'])).toBeLessThan(t.end);
      expect(t.end, String(w['id'])).toBeLessThanOrEqual(t.windup);
      checked++;
    }
    print(`steal windows checked: ${checked} of ${armed.length} armed weapons`);
    expect(checked).toBe(armed.length);
  });
});

/**
 * A rival holding `w` swings at the player on tick 5; the player presses attack at wind-up tick
 * `k`. Returns whether the player came away holding it.
 */
function scriptedSteal(w: SimWeaponDef, k: number): boolean {
  const h = makeHarness(
    [
      { s: 100, d: 0, role: 'rival', startingWeapon: w.contentId },
      { s: 100, d: 1.2, role: 'player', healthMax: 1000 },
    ],
    scriptOf({
      0: (t) => (t === 5 ? flags(F.attack) : undefined),
      1: (t) => (t === 5 + k ? flags(F.attack) : undefined),
    }),
    {},
    [w],
  );
  h.run(5 + w.windupTicks + 10);
  return ofType(h.events, 'weaponGrab').some((e) => e.data['source'] === 'steal' && e.actor === 1);
}

describe('weapons-2: a scripted steal works for each weapon', () => {
  it('inside the window the player takes it; a press before the window does not', () => {
    const lines: string[] = [];
    for (const raw of armed) {
      const w = simWeapon(raw);
      if (!w.steal) continue;
      const mid = Math.round((w.steal.startTick + w.steal.endTick) / 2);
      expect(scriptedSteal(w, mid), `${w.contentId} at tick ${mid}`).toBe(true);
      if (w.steal.startTick > 1)
        expect(scriptedSteal(w, w.steal.startTick - 1), `${w.contentId} early`).toBe(false);
      lines.push(`${w.contentId.replace('base:', '')} @${mid}/${w.windupTicks}`);
    }
    print(`scripted steals: ${lines.length} weapons (${lines.join(', ')})`);
    expect(lines.length).toBe(armed.length);
  });
});

describe('weapons-2: a new weapon added as data only plays without code changes', () => {
  it('loads through the real pack loader, reuses a registered behaviour, and lands hits', () => {
    const withFixture = buildRegistry(
      [...basePackFiles(), { path: 'weapons/pool-noodle.json', json: FIXTURE }],
      { includeDrafts: true },
    );
    const raw = (Object.values(withFixture.weapons) as unknown as Json[]).find(
      (w) => w['id'] === 'pool-noodle',
    );
    expect(raw).toBeDefined();
    const noodle = simWeapon(raw ?? {});
    expect(behaviourOf(noodle)).toBe('melee.swing');
    const h = makeHarness(
      [
        { s: 100, d: 0, role: 'player', startingWeapon: noodle.contentId },
        { s: 100, d: 1.2, role: 'rival' },
      ],
      scriptOf({ 0: (t) => (t === 3 ? flags(F.attack) : undefined) }),
      {},
      [noodle],
    );
    expect(combatView(h.world, 0).heldWeapon).toBe('base:pool-noodle');
    h.run(60);
    const hit = ofType(h.events, 'hit').find((e) => e.actor === 0);
    expect(hit?.data['weapon']).toBe('base:pool-noodle');
    expect(hit?.data['damage']).toBe(noodle.damage);
    expect(
      scriptedSteal(noodle, Math.round(((noodle.steal?.startTick ?? 0) + (noodle.steal?.endTick ?? 0)) / 2)),
    ).toBe(true);
  });
});
