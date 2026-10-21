import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork } from '../network';
import type { BakedNetwork, BakedRoad } from '../types';
import { iowaCountyLayout, iowaCountyPlanner, IOWA_COUNTY_TAG } from './iowa-county';
import { courseAt, roadBandHeight, roadsideGroundHeight } from '../course';
import { planStructures, structuresAt, topAt, type StructureSpec } from '../structures';
import { ensureStructures, raceStructures, structureLayersFor } from '../structures';
import { loadIowaCountyLayout } from '../index';
import { landEdgeOf, sectionGroundOf, zoneReachOf } from '../drawn-ground';

const root = 'packs/region-clinton/regions/clinton-iowa';
const read = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const network = read<BakedNetwork>(`${root}/networks/osm-clinton-ia136.json`);
const roads = network.roads.map((id) => read<BakedRoad>(`${root}/roads/${id}.json`));
const road = createRoadNetwork({ network, roads });

describe('Iowa county farmstead', () => {
  it('takes placement and site kind from authored features, including move and removal controls', () => {
    const withoutFeatures = roads.map((r) => ({
      ...r,
      features: r.features?.filter(
        (f) => !['county-loading-shed', 'county-corn-crib'].includes(String(f.params?.['place'])),
      ),
    }));
    expect(iowaCountyLayout(createRoadNetwork({ network, roads: withoutFeatures }), 1).facilities).toEqual(
      [],
    );
    const original = iowaCountyLayout(road, 1).facilities.find((f) => f.id === 'county-loading-shed')!;
    const control = createRoadNetwork({ network, roads: withoutFeatures });
    for (const facility of iowaCountyLayout(road, 1).facilities) {
      expect(landEdgeOf(road)(facility.edge, 1, facility.s)).toBe(
        landEdgeOf(control)(facility.edge, 1, facility.s),
      );
      const delta =
        sectionGroundOf(road)(facility.edge, facility.s, facility.d)! -
        sectionGroundOf(control)(facility.edge, facility.s, facility.d)!;
      // Existing zone ground is road-0.06m; the rural strip below is road-0.09m.
      expect(delta).toBeCloseTo(0.03, 5);
      expect(roadBandHeight(control, facility.edge, facility.s, facility.d)).not.toBeNull();
      // The pre-existing zone renderer adds a shallow strip on both sides. Its entire reach
      // must fit the land already there; the anchor must not manufacture a new ground island.
      for (let ds = -30; ds <= 30; ds += 0.5)
        for (const side of [-1, 1] as const) {
          const atS = facility.s + ds;
          const reach = zoneReachOf(road)(facility.edge, side, atS);
          const edge = control.edges[facility.edge]!;
          const outer =
            (side < 0 ? -edge.dMin : edge.dMax) + 0.6 + landEdgeOf(control)(facility.edge, side, atS);
          expect(reach).toBeLessThanOrEqual(outer - 0.5);
          for (let d = 8.25; d <= reach; d += 0.5)
            expect(
              roadBandHeight(control, facility.edge, atS, side * d),
              'zone stays within pre-existing connected land',
            ).not.toBeNull();
        }
    }
    const moved = roads.map((r) => ({
      ...r,
      features: r.features?.map((f) =>
        f.params?.['place'] === 'county-loading-shed' ? { ...f, s0: f.s0 + 1, s1: f.s1 + 1 } : f,
      ),
    }));
    const shifted = iowaCountyLayout(createRoadNetwork({ network, roads: moved }), 1).facilities.find(
      (f) => f.id === 'county-loading-shed',
    )!;
    expect(shifted).toBeDefined();
    expect(shifted.s).toBe(original.s + 1);
    const changedKind = roads.map((r) => ({
      ...r,
      features: r.features?.map((f) =>
        f.params?.['place'] === 'county-loading-shed'
          ? { ...f, params: { ...f.params, place: 'county-corn-crib' } }
          : f,
      ),
    }));
    const changed = iowaCountyLayout(createRoadNetwork({ network, roads: changedKind }), 1).facilities.find(
      (f) => f.id === original.id,
    )!;
    expect(changed.parts.some((p) => p.name === 'crib-roof')).toBe(true);
    expect(changed.parts.some((p) => p.name === 'shed-roof')).toBe(false);
  });
  it('loads the registered lazy physical layer through the public race path', async () => {
    const fresh = createRoadNetwork({ network, roads });
    expect(structureLayersFor(fresh)).toContain(IOWA_COUNTY_TAG);
    const layout = (await loadIowaCountyLayout()).iowaCountyLayout(fresh, 1);
    const prepared = await ensureStructures(fresh, 1),
      race = raceStructures(fresh, 1);
    for (const spec of layout.facilities.flatMap((f) => f.specs)) {
      expect(prepared.items.some((s) => s.layer === IOWA_COUNTY_TAG && s.rule === spec.rule)).toBe(true);
      expect(race.items.some((s) => s.layer === IOWA_COUNTY_TAG && s.rule === spec.rule)).toBe(true);
    }
  });
  it('provides a loading shed and agricultural crib on the actual county land', () => {
    const facilities = iowaCountyLayout(road, 1).facilities;
    expect(facilities.some((f) => f.id === 'county-loading-shed')).toBe(true);
    expect(facilities.some((f) => f.id === 'county-corn-crib')).toBe(true);
    for (const facility of facilities) {
      const verge = road.vergeAt(facility.edge, facility.s, 'right');
      for (const spec of facility.specs.filter((p) => !/apron|pad/.test(p.rule))) {
        const dx = spec.foot.x - facility.x,
          dz = spec.foot.z - facility.z;
        const across = -dx * facility.uz + dz * facility.ux;
        expect(facility.d - across - spec.foot.hv).toBeGreaterThan(verge.dOuter + 6);
      }
      for (let ds = -5; ds <= 5; ds += 0.4)
        for (let d = verge.dOuter + 0.25; d <= facility.d + 3.5; d += 0.4) {
          const y = roadsideGroundHeight(road, facility.edge, facility.s + ds, d);
          expect(y, `${facility.id} supported footprint ${ds},${d}`).not.toBeNull();
          expect(facility.y - y!).toBeGreaterThan(0);
          expect(facility.y - y!).toBeLessThan(0.11);
        }
    }
  });

  it('keeps the complete approach, exit, recovery and ordinary lane supported', () => {
    const f = iowaCountyLayout(road, 1).facilities.find((f) => f.id === 'county-loading-shed')!;
    for (let s = f.s - 70; s <= f.s + 110; s += 0.5) {
      for (const d of [-1.75, 1.75, 6.5, 8, 10, 12, 14, f.d])
        expect(roadBandHeight(road, f.edge, s, d)).not.toBeNull();
    }
  });

  it('refuses missing tags, the highway, Eagle Point and unsupported ground', () => {
    expect(iowaCountyLayout(road, 1).facilities.length).toBeGreaterThan(0);
    const stripped = roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== IOWA_COUNTY_TAG) }));
    expect(iowaCountyLayout(createRoadNetwork({ network, roads: stripped }), 1).facilities).toEqual([]);
    for (const id of ['osm-clinton-eagle-point']) {
      const n = read<BakedNetwork>(`${root}/networks/${id}.json`);
      const rs = n.roads.map((r) => read<BakedRoad>(`${root}/roads/${r}.json`));
      expect(iowaCountyLayout(createRoadNetwork({ network: n, roads: rs }), 1).facilities).toEqual([]);
    }
    const highwayTagged = stripped.map((r) => ({
      ...r,
      tags: r.id.includes('ia136-')
        ? [...(r.tags ?? []), { tag: IOWA_COUNTY_TAG, side: 'right' as const, s0: 0, s1: r.lengthM }]
        : r.tags,
    }));
    expect(iowaCountyLayout(createRoadNetwork({ network, roads: highwayTagged }), 1).facilities).toEqual([]);
    const hard = roads.map((r) => ({
      ...r,
      laneSections: r.laneSections.map((section) => ({
        ...section,
        verges: {
          left: { widthM: 3, surface: 'grass' as const, edge: 'hard' as const },
          right: { widthM: 3, surface: 'grass' as const, edge: 'hard' as const },
        },
      })),
    }));
    expect(iowaCountyLayout(createRoadNetwork({ network, roads: hard }), 1).facilities).toEqual([]);
  });

  it('has real posts and roof with clear end openings, and an apron that is genuine support', () => {
    const specs: StructureSpec[] = [];
    iowaCountyPlanner.plan(road, 1, { add: (s) => specs.push(s) - 1 });
    const layers = {
      [IOWA_COUNTY_TAG]: { tags: [IOWA_COUNTY_TAG], load: () => Promise.resolve(iowaCountyPlanner) },
    };
    const plan = planStructures(road, 1, { [IOWA_COUNTY_TAG]: iowaCountyPlanner }, layers);
    const f = iowaCountyLayout(road, 1).facilities.find((f) => f.id === 'county-loading-shed')!;
    const noApron = planStructures(
      createRoadNetwork({ network, roads }),
      1,
      {
        [IOWA_COUNTY_TAG]: {
          plan(_r, _s, out) {
            for (const spec of specs.filter((p) => !p.rule.endsWith(':loading-apron'))) out.add(spec);
          },
        },
      },
      layers,
    );
    for (let ds = -4.7; ds <= 4.7; ds += 0.25) {
      const pos = { edge: f.edge, s: f.s + ds, d: f.d };
      const p = road.toWorld(pos.edge, pos.s, pos.d, 0);
      const blocking = structuresAt(plan, p.x, p.z).filter(
        (st) => st.baseY < f.y + 2 && (topAt(st, p.x, p.z) ?? -Infinity) > f.y + 0.1,
      );
      expect(blocking).toEqual([]);
      expect(courseAt(road, plan, pos, f.y + 0.01).kind).toBe('top');
      expect(courseAt(road, noApron, pos, f.y + 0.01).kind).toBe('road');
    }
    expect(specs.some((p) => p.rule.endsWith(':shed-post'))).toBe(true);
    expect(specs.some((p) => p.rule.endsWith(':crib-slat'))).toBe(true);
  });
});
