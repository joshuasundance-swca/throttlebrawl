// Playtest 1c item 2 ([decided] 2026-09-30: "I want randomness so you don't see the same cars in
// the same order, ramp truck in the same place"). #190 lets the race seed pick one candidate per
// set-piece slot in the sim; render must draw exactly the picked ones, or a rider would see a ramp
// truck that is not there, or ride into one that is not drawn. The checks build the real Keys
// track with its live slot candidates (`params.slot`, added by the road lane in the integration
// round), and compare what is drawn with what road/setpieces.ts picks for the sim; and the tracks
// with every slot stripped, which must draw every set piece as before.
import { describe, expect, it } from 'vitest';
import {
  chooseSetPieces,
  createRoadNetwork,
  setPieceSlots,
  type BakedNetwork,
  type BakedRoad,
} from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';

const look = createFlatLook();
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

/** A network's roads as the packs have them, or with every set-piece slot stripped. */
function track(id: string, stripSlots = false) {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles)
    .filter((r) => network.roads.includes(r.id))
    .map((r) => {
      const features = (r.features ?? []).map((f) => {
        if (!stripSlots || f.params?.['slot'] === undefined) return f;
        const { slot: _slot, ...params } = f.params;
        return { ...f, params };
      });
      return { ...r, features };
    });
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

const drawnIds = (built: ReturnType<typeof buildRoadScene>) => built.stats.setPieces.map((p) => p.id).sort();

describe('set pieces drawn for the race seed (playtest 1c item 2)', () => {
  // The live Keys slots: the bridge truck at two spots, and three pads at two spots each.
  const slotted = track('keys-m1');
  const candidates = [...setPieceSlots(slotted.road.edges).values()].flat().sort();
  const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);

  it('draws exactly the candidates the sim picks, and every set piece without a slot', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const built = buildRoadScene(slotted.road, look, slotted.dressing, { seed, roadsideDensity: 0 });
      const picked = chooseSetPieces(slotted.road.edges, seed);
      expect(drawnIds(built), `seed ${seed}`).toEqual([...picked].sort());
      expect(built.stats.rampTrucks).toBe(1);
      expect(built.stats.boostPads).toBe(3);
      for (const id of picked) seen.add(id);
      built.dispose();
    }
    console.log(
      `[examined] ${SEEDS.length} seeds on keys-m1 with ${candidates.length} candidates; drawn: ${[...seen].sort().join(', ')}`,
    );
    // Over the seeds every candidate is drawn some of the time.
    expect(candidates.length).toBe(8);
    expect([...seen].sort()).toEqual(candidates);
  });

  it('moves the drawn truck and pad between two seeds that pick differently', () => {
    const a = buildRoadScene(slotted.road, look, slotted.dressing, { seed: 1, roadsideDensity: 0 });
    const pickA = [...chooseSetPieces(slotted.road.edges, 1)].sort().join();
    const other = SEEDS.find((s) => [...chooseSetPieces(slotted.road.edges, s)].sort().join() !== pickA);
    expect(other).toBeDefined();
    const b = buildRoadScene(slotted.road, look, slotted.dressing, { seed: other!, roadsideDensity: 0 });
    const at = (x: typeof a) =>
      x.stats.setPieces.map((p) => `${p.kind}@${p.x.toFixed(1)},${p.z.toFixed(1)}`).sort();
    expect(at(a)).not.toEqual(at(b));
    // The unslotted pads stay put.
    const fixed = (x: typeof a) =>
      x.stats.setPieces.filter((p) => p.slot === null).map((p) => `${p.x},${p.z}`);
    expect(fixed(a)).toEqual(fixed(b));
  });

  it('draws every set piece on a track with no slots, as before', () => {
    for (const id of ['keys-m1', 'pnw-c1', 'sf-hills']) {
      const t = track(id, true);
      const all = Object.values(t.dressing)
        .flatMap((r) => r.features ?? [])
        .filter((f) => f.kind === 'boostPad' || f.kind === 'rampTruck')
        .map((f) => f.id ?? '')
        .sort();
      for (const seed of [1, 2]) {
        expect(drawnIds(buildRoadScene(t.road, look, t.dressing, { seed, roadsideDensity: 0 }))).toEqual(all);
      }
      expect(all.length).toBeGreaterThanOrEqual(3);
    }
  });
});
