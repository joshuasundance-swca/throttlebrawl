// The street furniture's plan (playtest 4, "solid but forgiving"; road/furniture.ts): one plan, read by
// the sim to meet the pieces and by render to draw them. The checks plan real networks: the same seed
// gives the same plan, every kerb piece stands on its sidewalk (a ridable, paved band), each kind has its
// class, and a piece's footprint in the road frame follows its turn.
import { describe, expect, it } from 'vitest';
import { FURNITURE, FURNITURE_KINDS, kitOfNetwork, onRidableBand, planStreetFurniture } from './furniture';
import { createRoadNetwork } from './network';
import type { BakedNetwork, BakedRoad } from './types';

/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function network(id: string) {
  const [path, n] = Object.entries(networkFiles).find(([, x]) => x.id === id) ?? [];
  if (!n || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && n.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network: n, roads });
}

describe('the street furniture plan', () => {
  const downtown = network('sf-downtown');
  const duval = network('osm-keys-duval');
  const hills = network('osm-sf-russian-hill');

  it('picks the kit each network draws', () => {
    expect(kitOfNetwork(hills)).toBe('sf');
    expect(kitOfNetwork(duval)).toBe('keys');
    expect(kitOfNetwork(network('osm-pnw-gorge'))).toBe('pnw');
  });

  it('is the same for the same seed, and another seed moves the scattered pieces', () => {
    const a = planStreetFurniture(hills, 7);
    expect(planStreetFurniture(hills, 7)).toBe(a); // kept: worked out once
    const key = (p: { rule: string; edge: number; s: number; d: number }) =>
      `${p.rule}:${p.edge}:${p.s}:${p.d}`;
    const again = planStreetFurniture(network('osm-sf-russian-hill'), 7).items.map(key);
    expect(again).toEqual(a.items.map(key));
    const other = planStreetFurniture(hills, 8).items.map(key);
    expect(other).not.toEqual(again);
    stdout.write(
      `[examined] osm-sf-russian-hill: ${a.items.length} pieces at seed 7, ${other.length} at seed 8\n`,
    );
  });

  it('stands every kerb piece on its sidewalk, and every piece of every kind has its class and footprint', () => {
    let pieces = 0;
    const kinds = new Set<string>();
    for (const road of [downtown, duval, hills]) {
      for (const p of planStreetFurniture(road, 7).items) {
        pieces++;
        kinds.add(p.kind);
        expect(p.cls).toBe(FURNITURE[p.kind].cls);
        expect(p.shape.reachS).toBeGreaterThan(0);
        if (p.layer === 'kit') expect(onRidableBand(road, p), `${p.rule} at ${p.edge}:${p.s}`).toBe(true);
      }
    }
    stdout.write(`[examined] ${pieces} pieces of ${kinds.size} kinds over 3 networks\n`);
    expect(pieces).toBeGreaterThan(1500);
    // The waterfront's kinds are its own network's; the rest are here.
    for (const k of FURNITURE_KINDS.filter((x) => !['palm', 'wf-lamp', 'wf-bench', 'parked-car'].includes(x)))
      expect(kinds.has(k), k).toBe(true);
  });

  it("turns a piece's footprint with it: a bench facing the road lies along it", () => {
    const bench = planStreetFurniture(downtown, 7).items.find((p) => p.kind === 'dt-bench');
    if (!bench) throw new Error('no bench');
    // The bench's 2 m length is its x; facing the road, x runs along the road.
    expect(bench.shape.reachS).toBeCloseTo(1, 1);
    expect(bench.shape.reachD).toBeCloseTo(0.31, 1);
  });

  it('has a class and a footprint for every kind (the docs table and the hitbox audit read them)', () => {
    for (const k of FURNITURE_KINDS) {
      const f = FURNITURE[k];
      expect(['solid', 'light']).toContain(f.cls);
      expect(f.foot.length).toBeGreaterThan(0);
      expect(f.heightM).toBeGreaterThan(0);
    }
  });
});
