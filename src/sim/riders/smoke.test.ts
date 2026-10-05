// A smoking bike is a little slower (playtest 4, P4-14; the maintainer's answer "A little": about
// 5 to 10 % less top speed while it smokes, repairs between races fix it, tunable). A bike smokes
// at or under SMOKE_HEALTH of its rider's health (the render draws the smoke from the same number).
// Each test states the rule it protects and steps the real riding model by ticks on a straight.
import { describe, expect, it } from 'vitest';
import { riderState, RIDERS_TUNING } from './index';
import { SMOKE_HEALTH, smokeTopScale } from './smoke';
import { input, packHarness, riderHarness, testConfig } from './testing';

const FULL_GAS_TICKS = 40 * 60;

/** The decl of the smoke slowdown's tuning key. */
const decl = RIDERS_TUNING.find((d) => d.id === 'riders.smokeSlowdown');

/**
 * The top speed a player reaches in 40 s of full throttle with the given share of his health,
 * optionally healed to `healedTo` at tick `healAt` (the way regeneration does).
 */
function topAt(
  share: number,
  tuning: Record<string, number> = {},
  heal?: { at: number; to: number },
): number {
  const h = riderHarness(testConfig({ tuning }), { s: 50, d: 1.7 });
  const health = riderState(h.world).health;
  const max = h.config.riders[0]?.healthMax ?? 100;
  health[h.rider.id] = max * share;
  let top = 0;
  for (let t = 0; t < FULL_GAS_TICKS; t++) {
    if (heal && t === heal.at) health[h.rider.id] = max * heal.to;
    h.step(input(1));
    top = Math.max(top, h.rider.speed);
  }
  return top;
}

describe('a smoking bike loses a little top speed (P4-14)', () => {
  it('declares one tuning key, a share of top speed, inside the decided 5 to 10 %', () => {
    expect(decl).toBeDefined();
    expect(decl?.affectsSim).toBe(true);
    expect(decl?.default).toBeGreaterThanOrEqual(0.05);
    expect(decl?.default).toBeLessThanOrEqual(0.1);
    expect(decl?.min).toBe(0);
  });

  it('a bike at the smoking line tops out 5 to 10 % under a healthy one', () => {
    const healthy = topAt(1);
    const smoking = topAt(SMOKE_HEALTH);
    expect(smoking).toBeLessThan(healthy * 0.95 + 1e-6);
    expect(smoking).toBeGreaterThan(healthy * 0.9 - 1e-6);
  });

  it('a bike just above the line is not slowed, and a badly hurt one is slowed no more than at the line', () => {
    const healthy = topAt(1);
    expect(topAt(SMOKE_HEALTH + 0.02)).toBeCloseTo(healthy, 6);
    expect(topAt(0.05)).toBeCloseTo(topAt(SMOKE_HEALTH), 6);
  });

  it('follows the tuning key: raised it slows more, at 0 the bike is not slowed', () => {
    const healthy = topAt(1);
    expect(topAt(0.2, { 'riders.smokeSlowdown': 0 })).toBeCloseTo(healthy, 6);
    expect(topAt(0.2, { 'riders.smokeSlowdown': 0.2 })).toBeLessThan(healthy * 0.81);
  });

  it('is lifted when the health comes back above the line (a repair, or the player healing)', () => {
    const healthy = topAt(1);
    expect(topAt(0.2, {}, { at: 600, to: 1 })).toBeGreaterThan(healthy * 0.995);
  });

  it('a rival who smokes is slowed by the same rule as the player', () => {
    const config = testConfig({ rivals: 1 });
    const h = packHarness(config, [
      { s: 50, d: -1.7 },
      { s: 50, d: 1.7 },
    ]);
    const max = config.riders[0]?.healthMax ?? 100;
    const health = riderState(h.world).health;
    const [rival, player] = h.riders;
    if (!rival || !player) throw new Error('no riders');
    health[rival.id] = max * 0.2;
    let rivalTop = 0;
    let playerTop = 0;
    for (let t = 0; t < FULL_GAS_TICKS; t++) {
      h.step([input(1), input(1)]);
      rivalTop = Math.max(rivalTop, rival.speed);
      playerTop = Math.max(playerTop, player.speed);
    }
    expect(rivalTop).toBeLessThan(playerTop * 0.95 + 1e-6);
    expect(rivalTop).toBeGreaterThan(playerTop * 0.9 - 1e-6);
  });

  it('every race starts with every bike repaired (health is full, so no one smokes at the grid)', () => {
    const h = riderHarness(testConfig(), { s: 50, d: 1.7 });
    const max = h.config.riders[0]?.healthMax ?? 0;
    expect(riderState(h.world).health[h.rider.id]).toBe(max);
    expect(smokeTopScale(0.075, max, max)).toBe(1);
  });

  it('smokeTopScale: 1 with no health to speak of, and never raises a top speed', () => {
    expect(smokeTopScale(0.075, 50, 0)).toBe(1);
    expect(smokeTopScale(0, 10, 100)).toBe(1);
    expect(smokeTopScale(-1, 10, 100)).toBe(1);
    expect(smokeTopScale(0.075, 34, 100)).toBeCloseTo(0.925, 12);
  });
});
