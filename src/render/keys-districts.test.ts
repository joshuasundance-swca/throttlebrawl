// Distinct keys (run W-Q; interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS": a fishing village,
// a resort strip, a junkyard key and a party key played as the hangover, "each with its own look").
// The checks build the real Keys network from its road files and scatter the real kit: each key's
// own props stand on that key and nowhere else, the conch town's props stay out of the keys they do
// not belong in, every route hops between keys, and each key has its own signs.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, type RoadDressing } from './road-mesh';
import { inDistrict, KEYS_KIT, scatterRoadside, type RoadsideItem } from './roadside';
import type { SideTag } from './scenery';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);

const network = Object.values(
  import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/keys-m1.json', {
    eager: true,
    import: 'default',
  }),
)[0]!;
const roads = Object.values(
  import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => network.roads.includes(r.id));
interface RouteFile {
  id: string;
  network: string;
  mainPath: string[];
  finish: { road: string };
}
const routes = Object.values(
  import.meta.glob<RouteFile>('../../packs/base/regions/florida-keys/routes/*.json', {
    eager: true,
    import: 'default',
  }),
).filter((r) => r.network === 'keys-m1');
interface BoardItem {
  id: string;
  text: string;
  tags?: string[];
}
const region = Object.values(
  import.meta.glob<{ signs: BoardItem[]; billboards: BoardItem[] }>(
    '../../packs/base/regions/florida-keys/region.json',
    { eager: true, import: 'default' },
  ),
)[0]!;

const KEYS = ['key-fishing', 'key-resort', 'key-junkyard', 'key-party'] as const;
const look = createFlatLook();
const road: RoadNetwork = createRoadNetwork({ network, roads });
const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
const tagsOf = (edge: number): readonly SideTag[] => dressing[road.edges[edge]!.id]?.tags ?? [];
const sideOf = (it: RoadsideItem) => (it.d < 0 ? 'left' : 'right');

function scatter(seed: number): RoadsideItem[] {
  const built = buildRoadScene(road, look, dressing, { seed });
  const items = scatterRoadside({
    road,
    dressing,
    seed,
    density: 1,
    kit: KEYS_KIT,
    landReach: (e, side, s) => built.landReach(e, side, s),
    spots: built.spots,
  });
  built.dispose();
  return items;
}

const SEEDS = [1, 7, 42];
const bySeed = SEEDS.map((seed) => ({ seed, items: scatter(seed) }));

describe('the distinct Keys (keys-m1)', () => {
  it("stands each key's own props on that key only, and plenty of them", () => {
    // Old Town's rules draw from the Duval kit and stand only on Duval (duval.test.ts covers them).
    const districtRules = KEYS_KIT.rules.filter((r) => r.district && !r.model);
    expect(districtRules.length).toBeGreaterThanOrEqual(14);
    const placed = new Map<string, number>();
    for (const { seed, items } of bySeed) {
      const perKey = new Map<string, number>();
      for (const it of items) {
        const rule = KEYS_KIT.rules.find((r) => r.id === it.rule)!;
        if (rule.district) {
          expect(
            inDistrict(tagsOf(it.edge), sideOf(it), it.s, rule.district),
            `${it.rule} at s ${it.s}`,
          ).toBe(true);
          placed.set(it.rule, (placed.get(it.rule) ?? 0) + 1);
          for (const k of rule.district) perKey.set(k, (perKey.get(k) ?? 0) + 1);
        }
        if (rule.notDistrict)
          expect(
            inDistrict(tagsOf(it.edge), sideOf(it), it.s, rule.notDistrict),
            `${it.rule} at s ${it.s}`,
          ).toBe(false);
      }
      print(
        `[examined] keys-m1 seed ${seed}: ${items.length} props; own props per key ${[...perKey].join(', ')}`,
      );
      for (const k of KEYS) expect(perKey.get(k) ?? 0, `${k}, seed ${seed}`).toBeGreaterThanOrEqual(8);
    }
    print(
      `[examined] district props over ${SEEDS.length} seeds: ${[...placed].map(([k, n]) => `${k} ${n}`).join(', ')}`,
    );
    for (const r of districtRules) expect(placed.get(r.id) ?? 0, r.id).toBeGreaterThan(0);
  });

  it('keeps the conch town (cottages and pickets) out of every other key', () => {
    let town = 0;
    for (const { items } of bySeed)
      for (const it of items) {
        if (!['cottage', 'picket'].includes(it.rule)) continue;
        town++;
        expect(inDistrict(tagsOf(it.edge), sideOf(it), it.s, [...KEYS])).toBe(false);
      }
    print(`[examined] ${town} conch-town props over ${SEEDS.length} seeds, none on the other keys`);
    expect(town).toBeGreaterThan(0);
  });

  it('hops between keys on every route, and the long haul ends on the party key', () => {
    const keysOn = (roadIds: readonly string[]) =>
      KEYS.filter((k) =>
        roadIds.some((id) =>
          (dressing[id]?.tags as readonly SideTag[] | undefined)?.some((t) => t.tag === k),
        ),
      );
    expect(routes.length).toBe(3);
    for (const r of routes) {
      const ks = keysOn(r.mainPath);
      print(`[examined] route ${r.id}: ${r.mainPath.length} roads, keys ${ks.join(', ')}`);
      expect(ks.length, r.id).toBeGreaterThanOrEqual(2);
    }
    const long = routes.find((r) => r.id === 'm1-long-haul')!;
    expect(keysOn([long.finish.road])).toEqual(['key-party']);
    expect(keysOn(long.mainPath)).toEqual([...KEYS]);
  });

  it('gives each key its own signs, standing on that key', () => {
    const items = new Map([...region.signs, ...region.billboards].map((i) => [i.id, i]));
    const perKey = new Map<string, number>();
    for (const r of roads)
      for (const f of r.features ?? []) {
        if (f.kind !== 'billboard') continue;
        const item = items.get((f as { item?: string }).item ?? '');
        const key = item?.tags?.find((t) => t.startsWith('key-'));
        if (!key) continue;
        // The slot stands on the side it names, inside the key its words belong to.
        const side = f.d0 + f.d1 < 0 ? 'left' : 'right';
        expect(inDistrict(r.tags as readonly SideTag[], side, (f.s0 + f.s1) / 2, [key]), f.id).toBe(true);
        perKey.set(key, (perKey.get(key) ?? 0) + 1);
      }
    print(`[examined] key signs and billboards placed: ${[...perKey].join(', ')}`);
    for (const k of KEYS) expect(perKey.get(k) ?? 0, k).toBeGreaterThanOrEqual(3);
    // Every key's item is placed somewhere (no orphan words). The Old Town's (`key-oldtown`) stand on
    // the real Duval Street network, not keys-m1: tests/sim/keys-real-world.test.ts places them.
    const placed = new Set(
      roads.flatMap((r) => (r.features ?? []).map((f) => (f as { item?: string }).item)),
    );
    for (const i of items.values())
      if (i.tags?.some((t) => t.startsWith('key-') && t !== 'key-oldtown'))
        expect(placed.has(i.id), i.id).toBe(true);
  });
});
