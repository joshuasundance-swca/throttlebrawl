import { describe, expect, it } from 'vitest';
import { basePackFiles, buildRegistry, loadBasePack } from '../content';
import { aiController, buildSimConfig, streamForEvent } from './config';

const shove = {
  type: 'weapon',
  id: 'test-shove',
  name: 'Test Shove',
  category: 'unarmed',
  behaviour: 'melee.swing',
  unarmed: true,
  reach: { sM: 1, dM: 1.7 },
  windupS: 0.22,
  activeS: 0.1,
  recoveryS: 0.45,
  cooldownS: 0.5,
  damage: 14,
  knockback: { lateralMps: 5.5, staggerS: 0.3 },
  hitStopMs: 60,
  meta: { status: 'live' },
};

function configWith(weapon: Record<string, unknown>) {
  const reg = buildRegistry([
    ...basePackFiles(),
    { path: `weapons/${String(weapon['id'])}.json`, json: weapon },
  ]);
  return buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
}

describe('app: buildSimConfig resolves weapons', () => {
  it('carries knockback speed and stagger (in ticks) into SimWeaponDef', () => {
    const w = configWith(shove).weapons.find((x) => x.contentId === 'base:test-shove');
    expect(w).toMatchObject({
      windupTicks: 13,
      activeTicks: 6,
      recoveryTicks: 27,
      cooldownTicks: 30,
      knockbackMps: 5.5,
      staggerTicks: 18,
      hitStopMs: 60,
    });
  });

  it('defaults knockback to none when the weapon has no knockback block', () => {
    const { knockback: _drop, ...plain } = shove;
    const w = configWith(plain).weapons.find((x) => x.contentId === 'base:test-shove');
    expect(w?.knockbackMps).toBe(0);
    expect(w?.staggerTicks).toBe(0);
  });
});

describe('app: the base pack punch and kick (combat-1, M1 starting numbers)', () => {
  const reg = buildRegistry(basePackFiles());
  const config = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
  const byId = (id: string) => config.weapons.find((w) => w.contentId === id);

  it('punch: 7 / 5 / 15 ticks, reach 1.2 m × 1.4 m, 60 ms hit-stop, no cooldown', () => {
    expect(byId('base:punch')).toMatchObject({
      unarmed: true,
      reachSM: 1.2,
      reachDM: 1.4,
      windupTicks: 7,
      activeTicks: 5,
      recoveryTicks: 15,
      cooldownTicks: 0,
      hitStopMs: 60,
    });
  });

  it('kick: 13 / 6 / 27 ticks, a 30-tick cooldown, reach 1.0 m × 1.7 m, and a harder shove', () => {
    const kick = byId('base:kick');
    expect(kick).toMatchObject({
      unarmed: true,
      reachSM: 1.0,
      reachDM: 1.7,
      windupTicks: 13,
      activeTicks: 6,
      recoveryTicks: 27,
      cooldownTicks: 30,
      hitStopMs: 60,
    });
    expect(kick?.knockbackMps ?? 0).toBeGreaterThan(byId('base:punch')?.knockbackMps ?? 0);
  });

  it('starts the combat tuning scales at 1', () => {
    expect(config.tuning['combat.hitStopScale']).toBe(1);
    expect(config.tuning['combat.knockbackScale']).toBe(1);
  });
});

describe('app/config: rival personalities reach the sim (the ai-1 contract wire)', () => {
  it('passes a rider’s own personality numbers, target list and side through with its style', () => {
    const c = aiController({
      style: 'heavy-hitter',
      aggression: 0.9,
      dirtiness: 0.25,
      weave: 0,
      targetPreference: ['player', 'nearest'],
      preferredSide: 'left',
    });
    expect(c).toEqual({
      kind: 'ai',
      style: 'heavy-hitter',
      personality: {
        aggression: 0.9,
        dirtiness: 0.25,
        weave: 0,
        targetPreference: ['player', 'nearest'],
        preferredSide: 'left',
      },
    });
  });

  it('drops fields of the wrong type and defaults a missing personality to the racer style', () => {
    const c = aiController({
      style: 'racer',
      aggression: 'lots',
      courage: Number.NaN,
      targetPreference: [1, 2],
      preferredSide: 'up',
    });
    expect(c).toEqual({ kind: 'ai', style: 'racer', personality: {} });
    expect(aiController(undefined)).toEqual({ kind: 'ai', style: 'racer', personality: {} });
  });

  it('builds every rival of the base event with an ai controller carrying its style', () => {
    const reg = loadBasePack();
    const config = buildSimConfig(reg, streamForEvent(reg), { seed: 1 });
    const rivals = config.riders.filter((r) => r.controller.kind === 'ai');
    expect(rivals.length).toBeGreaterThan(0);
    for (const r of rivals) {
      if (r.controller.kind !== 'ai') throw new Error('unreachable');
      expect(typeof r.controller.style).toBe('string');
      expect(r.controller.personality).toBeTypeOf('object');
    }
  });
});
