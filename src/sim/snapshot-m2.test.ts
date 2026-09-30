// The M2 snapshot contract (docs/milestones/M2.md, app-3 item 5): `slowmo` on the snapshot and,
// per rider, `styleTally` and `grudgeNotedBy`. The owning systems publish them through the
// sim/world facts helpers (combat-4 the slow motion, sim/race the style tally, tumble-2 the
// grudges), so no wiring PR is needed when they land; the snapshot and the hash read them here.
import { describe, expect, it } from 'vitest';
import { neutralInput } from './api';
import { createSimWithWorld } from './create';
import { testConfig } from './riders/testing';
import { addStyle, noteGrudge, setSlowmo, worldHash } from './world';

describe('sim snapshot: the M2 facts', () => {
  it('starts neutral: no slow motion, no style, no grudges', () => {
    const { sim } = createSimWithWorld(testConfig({ rivals: 2 }));
    const snap = sim.snapshot();
    expect(snap.slowmo).toEqual({ active: false, remainingTicks: 0 });
    const riders = snap.entities.filter((e) => e.kind === 'rider');
    expect(riders.length).toBe(3);
    for (const r of riders) {
      expect(r.styleTally).toBe(0);
      expect(r.grudgeNotedBy).toEqual([]);
    }
  });

  it('shows what the systems publish', () => {
    const { sim, world } = createSimWithWorld(testConfig({ rivals: 2 }));
    const player = sim.snapshot().entities.find((e) => e.slot === 0);
    if (!player) throw new Error('no player');
    const rival = sim.snapshot().entities.find((e) => e.kind === 'rider' && e.slot === -1);
    if (!rival) throw new Error('no rival');
    setSlowmo(world, 42);
    addStyle(world, player.id, 150);
    addStyle(world, player.id, 25);
    noteGrudge(world, rival.id, player.id);
    noteGrudge(world, rival.id, player.id); // noted once per holder
    const snap = sim.snapshot();
    expect(snap.slowmo).toEqual({ active: true, remainingTicks: 42 });
    const me = snap.entities[player.id];
    expect(me?.styleTally).toBe(175);
    expect(me?.grudgeNotedBy).toEqual([rival.id]);
    expect(snap.entities[rival.id]?.grudgeNotedBy).toEqual([]);
    setSlowmo(world, 0);
    expect(sim.snapshot().slowmo).toEqual({ active: false, remainingTicks: 0 });
  });

  it('hashes the facts, and a snapshot never changes the hash', () => {
    const { sim, world } = createSimWithWorld(testConfig());
    sim.step([neutralInput()]);
    const before = sim.hash();
    sim.snapshot();
    expect(sim.hash()).toBe(before);
    expect(worldHash(world)).toBe(before);
    addStyle(world, 0, 10);
    expect(sim.hash()).not.toBe(before);
  });
});
