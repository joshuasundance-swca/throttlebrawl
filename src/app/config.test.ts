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
