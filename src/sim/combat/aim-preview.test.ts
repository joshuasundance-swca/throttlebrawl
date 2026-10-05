// Playtest 4's attack aim (P4-6, [decided] "Auto-aim + swipe"): the player sees the rider a tap will
// hit. The sim names him (`aimPreview`, the snapshot's `aimId`) with the very rule the press uses, so
// the marker can never disagree with the blow:
// - the preview is the target an auto-sided press would take, for every placement tried;
// - it is the nearest rider on either side, a cop only when no rider is there;
// - nobody in reach (or a downed rival) previews nobody;
// - only a player's rider carries one in the snapshot.
import { describe, expect, it } from 'vitest';
import { createSimWithWorld } from '../create';
import { aimPreview, combatView } from './index';
import { F, flags, harnessConfig, makeHarness, scriptOf, type Placement } from './harness.test-util';

/** A player at s 100 pressing a plain attack on tick `at`, and the others as placed. */
function field(others: readonly Placement[], at = 5) {
  return makeHarness(
    [{ s: 100, d: 0, role: 'player' }, ...others],
    scriptOf({ 0: (t) => (t === at ? flags(F.attack) : undefined) }),
  );
}

describe('P4-6: the rider a tap will hit is previewed by the same rule as the press', () => {
  const placements: readonly (readonly Placement[])[] = [
    [{ s: 104, d: 1.2, role: 'rival' }],
    [{ s: 104, d: -1.2, role: 'rival' }],
    [{ s: 97, d: -1.2, role: 'rival' }],
    [
      { s: 103.5, d: 1.2, role: 'rival' },
      { s: 102, d: -1.2, role: 'rival' },
    ],
    [
      { s: 102, d: 1.2, role: 'rival' },
      { s: 103.5, d: -1.2, role: 'rival' },
    ],
    [
      { s: 103, d: 1.2, role: 'cop' },
      { s: 103.5, d: -1.2, role: 'rival' },
    ],
  ];

  for (const [i, others] of placements.entries()) {
    it(`placement ${i}: the previewed rider is the one the press takes`, () => {
      const h = field(others);
      h.run(5);
      const before = aimPreview(h.world, h.config, 0);
      expect(before).toBeGreaterThanOrEqual(0);
      h.run(1); // the press tick
      expect(combatView(h.world, 0).targetId).toBe(before);
    });
  }

  it('the nearest rider on either side, and a rider before a cop', () => {
    const left = field([
      { s: 103.5, d: 1.2, role: 'rival' },
      { s: 102, d: -1.2, role: 'rival' },
    ]);
    expect(aimPreview(left.world, left.config, 0)).toBe(2);
    const right = field([
      { s: 102, d: 1.2, role: 'rival' },
      { s: 103.5, d: -1.2, role: 'rival' },
    ]);
    expect(aimPreview(right.world, right.config, 0)).toBe(1);
    const cop = field([
      { s: 102, d: 1.2, role: 'cop' },
      { s: 103.5, d: -1.2, role: 'rival' },
    ]);
    expect(aimPreview(cop.world, cop.config, 0)).toBe(2);
  });

  it('nobody in reach previews nobody', () => {
    const far = field([{ s: 160, d: 0, role: 'rival' }]);
    expect(aimPreview(far.world, far.config, 0)).toBe(-1);
  });

  it('a downed rival is not previewed', () => {
    const h = field([{ s: 104, d: 1.2, role: 'rival' }]);
    const health = (h.world.systems['riders'] as { health: number[] }).health;
    health[1] = 0;
    expect(aimPreview(h.world, h.config, 0)).toBe(-1);
  });

  it('during an attack the preview is the attack’s own target', () => {
    const h = field([
      { s: 104, d: 1.2, role: 'rival' },
      { s: 103.8, d: -1.2, role: 'rival' },
    ]);
    h.run(7);
    expect(combatView(h.world, 0).attackPhase).not.toBe('idle');
    expect(aimPreview(h.world, h.config, 0)).toBe(combatView(h.world, 0).targetId);
  });
});

describe('P4-6: the snapshot carries the aim for a player’s rider only', () => {
  it('aimId names the rival ahead for the player and is -1 for the rival', () => {
    const config = harnessConfig([
      { s: 100, d: 0, role: 'player' },
      { s: 104, d: 1.2, role: 'rival' },
    ]);
    const { sim, world } = createSimWithWorld(config);
    const [a, b] = world.movers;
    if (!a || !b) throw new Error('movers');
    Object.assign(a.pos, { s: 300, d: 0 });
    Object.assign(b.pos, { s: 304, d: 1.2 });
    const snap = sim.snapshot();
    const me = snap.entities.find((e) => e.id === a.id);
    const rival = snap.entities.find((e) => e.id === b.id);
    expect(me?.aimId).toBe(b.id);
    expect(rival?.aimId ?? -1).toBe(-1);
  });
});
