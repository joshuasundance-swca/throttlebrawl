// cops-1: Sgt. Pruitt is spawned from the road's `copSpawn` feature (docs/milestones/M1.md,
// cops-1 Builds), not from a grid slot. The base event's road-1 track puts one, the bait-shop lot
// (`bait-shop-lot`), beside Marina Run at s 4..20, d 6.1..9.6 (5.5..9 before playtest 1's wider
// lanes). He waits, parked on the shoulder at the lot's road edge, until his siren, then pulls out
// after the player. Checked on the real base race (the producer the batch uses), then over the
// shared batch's traces. Since playtest 2 (2026-10-02) the starting cops patrol up the road and the
// lot keeps the field's last cop (for a speed trap or chaos); the batch check follows whichever cop
// sounds the first siren, a patrol cop, from his spot on the shoulder.
/// <reference types="vite/client" />
import { beforeAll, describe, expect, it } from 'vitest';
import { BATCH_TIMEOUT_MS, createBatchRace, simBatch, type BatchResult } from './batch';

let batch: BatchResult;
beforeAll(async () => {
  batch = await simBatch();
}, BATCH_TIMEOUT_MS);

describe('cops: Sgt. Pruitt starts from the copSpawn feature', () => {
  it('waits at the bait-shop lot on Marina Run, on the shoulder clear of the lanes, facing the race', () => {
    const { sim, config } = createBatchRace(1);
    const edge = config.road.edgeIndex('m1-marina-run');
    const lot = config.road.featuresOf(edge, 'copSpawn');
    expect(lot.map((f) => f.id)).toEqual(['bait-shop-lot']);
    const cop = sim
      .snapshot()
      .entities.filter((e) => e.faction === 'law')
      .at(-1); // the lot's cop: the patrol takes the first ones
    expect(cop?.road.edge).toBe(edge);
    expect(cop?.road.s).toBeGreaterThanOrEqual(lot[0]?.s0 ?? NaN);
    expect(cop?.road.s).toBeLessThanOrEqual(lot[0]?.s1 ?? NaN);
    const lanes = config.road.lanesAt(edge, cop?.road.s ?? 0);
    const shoulder = lanes.find((l) => l.kind === 'shoulder' && l.dCenterM > 0); // the lot is on the right
    expect(cop?.road.d).toBeCloseTo(shoulder?.dCenterM ?? NaN, 5);
    for (const l of lanes.filter((x) => x.kind === 'drive'))
      expect(Math.abs((cop?.road.d ?? 0) - l.dCenterM)).toBeGreaterThan(l.widthM / 2);
    expect(cop?.road.dir).toBe(config.route.start.dir);
    expect(cop?.speed).toBe(0);
  });

  it('in every batch race the first cop to sound his siren sits on the shoulder until then, then gives chase', () => {
    const lines: string[] = [];
    const { config } = createBatchRace(1);
    for (const r of batch.races) {
      const lit = r.events.find((e) => e.type === 'siren' && e.data['on'] === true);
      const siren = lit?.tick ?? Infinity;
      const samples = r.trace.map((t) => ({ tick: t.tick, cop: t.movers.find((m) => m.id === lit?.actor) }));
      const before = samples.filter((x) => x.tick < siren);
      const first = before[0]?.cop;
      expect(before.length, `seed ${r.seed}: samples before the siren`).toBeGreaterThan(0);
      for (const x of before) {
        expect(x.cop?.speed, `seed ${r.seed} t${x.tick}: parked`).toBe(0);
        expect(x.cop?.edge).toBe(first?.edge);
        expect(x.cop?.s).toBeCloseTo(first?.s ?? NaN, 5);
        expect(x.cop?.d).toBeCloseTo(first?.d ?? NaN, 5);
      }
      // On the shoulder: clear of every drive lane.
      for (const l of config.road.lanesAt(first?.edge ?? -1, first?.s ?? 0).filter((x) => x.kind === 'drive'))
        expect(Math.abs((first?.d ?? 0) - l.dCenterM), `seed ${r.seed}: off the lanes`).toBeGreaterThan(
          l.widthM / 2,
        );
      // Within 30 s of the siren he is riding at chase speed.
      const chasing = samples.find(
        (x) => x.tick > siren && x.tick <= siren + 1800 && (x.cop?.speed ?? 0) > 10,
      );
      expect(chasing, `seed ${r.seed}: gives chase`).toBeDefined();
      if (r.seed === 1)
        lines.push(
          `seed 1: parked at edge ${first?.edge} s ${first?.s.toFixed(1)} d ${first?.d.toFixed(2)} ` +
            `for ${before.length} samples; siren t${siren}; ${chasing?.cop?.speed.toFixed(1)} m/s at t${chasing?.tick}`,
        );
    }
    process.stdout.write(`cops spawn: ${batch.races.length} races checked; ${lines.join('')}\n`);
  });
});
