// M3 traffic-4 follow-up 4 (scratch traffic4-hs report): a pedestrian's or an animal's snapshot
// carries its traffic type's content id, as a vehicle's already does, so render can draw an
// iguana, a pelican or a gator as itself rather than as the generic pedestrian figure. Presentation
// data only: the snapshot is not hashed, and no sim state changes.
import { describe, expect, it } from 'vitest';
import { createBatchRace, runSeededRace } from './batch';

describe('pedestrian and animal snapshots carry their content id', () => {
  it('names every pedestrian and animal by its traffic type over a seeded race', () => {
    const { config } = createBatchRace(1);
    const pedTypes = new Set(
      config.trafficTypes
        .filter((t) => t.category === 'pedestrian' || t.category === 'animal')
        .map((t) => t.contentId),
    );
    const seen = new Map<string, number>();
    let pedTicks = 0;
    const blank: string[] = [];
    runSeededRace(1, {
      noReplay: true,
      onTick: (snap) => {
        for (const e of snap.entities) {
          if (e.kind !== 'ped') continue;
          pedTicks++;
          seen.set(e.contentId, (seen.get(e.contentId) ?? 0) + 1);
          if (!pedTypes.has(e.contentId) && blank.length < 5)
            blank.push(`tick ${snap.tick} ped ${e.id}: '${e.contentId}'`);
        }
      },
    });
    console.log(
      `[examined] ${pedTicks} pedestrian-ticks, seed 1; content ids seen: ${[...seen].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    );
    expect(pedTicks).toBeGreaterThan(100);
    expect(blank).toEqual([]);
    // Both people and animals are in the sample.
    const categories = new Set(
      [...seen.keys()].map((id) => config.trafficTypes.find((t) => t.contentId === id)?.category),
    );
    expect([...categories].sort()).toEqual(['animal', 'pedestrian']);
  });
});
