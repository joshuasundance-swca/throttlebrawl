import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  footContains,
  loadPnwPlacesLayout,
  structureLayersFor,
  type BakedNetwork,
  type BakedRoad,
} from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { hasPnwPlaces, placeItems, spotAt } from './pnw-places';
import { buildRoadScene } from './road-mesh';

const networks = import.meta.glob<BakedNetwork>('/packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const files = import.meta.glob<BakedRoad>('/packs/region-pnw/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const network = Object.values(networks).find((n) => n.id === 'osm-pnw-longview')!;
const roads = Object.values(files).filter((r) => network.roads.includes(r.id));
const { pnwPlacesLayout } = await loadPnwPlacesLayout();

describe('Port Shift freight yards are physical places on real ground', () => {
  it('draws solid geometry at its registered world footprint and height, and catches a displaced model', () => {
    const road = createRoadNetwork({ network, roads });
    const layout = pnwPlacesLayout(road, 1);
    const items = placeItems(road, 1, layout);
    let vertices = 0;
    for (const yard of layout.workyards) {
      const item = items.find((i) => i.s === yard.s && i.d === yard.d && i.kind === yard.kind)!;
      const position = item.geometry.getAttribute('position');
      const spot = spotAt(road, item),
        c = Math.cos(spot.turn),
        s = Math.sin(spot.turn);
      const covered = (shift: number) => {
        for (let i = 0; i < position.count; i++) {
          const x = spot.p.x + position.getX(i) * c + position.getZ(i) * s + shift;
          const z = spot.p.z - position.getX(i) * s + position.getZ(i) * c;
          const y = spot.p.y + position.getY(i);
          const hit = yard.specs.some((spec) => {
            const foot = { ...spec.foot, hu: spec.foot.hu + 0.025, hv: spec.foot.hv + 0.025 };
            const top = spec.baseY + (spec.roof.kind === 'flat' ? spec.roof.topM : spec.roof.ridgeM);
            return footContains(foot, x, z) && y >= spec.baseY - 0.025 && y <= top + 0.025;
          });
          if (!hit) return false;
        }
        return true;
      };
      expect(position.count).toBeGreaterThan(0);
      expect(covered(0), `${yard.kind}: rendered vertices inside physical boxes`).toBe(true);
      expect(covered(1), 'moved-model negative control').toBe(false);
      vertices += position.count;
    }
    console.log(
      `[examined] ${vertices} rendered freight vertices against registered contact footprints/heights and displaced-model controls`,
    );
  });
  it('loads the place layer and stages freight sheds and timber decks, with a removed-tag control', () => {
    const road = createRoadNetwork({ network, roads });
    expect(structureLayersFor(road)).toContain('pnw-places');
    expect(hasPnwPlaces(new Set(['longview-port-yard']))).toBe(true);
    const layout = pnwPlacesLayout(road, 1);
    const items = placeItems(road, 1, layout);
    expect(items.some((i) => i.kind === 'freight-shed')).toBe(true);
    expect(items.some((i) => i.kind === 'timber-deck')).toBe(true);
    const control = createRoadNetwork({
      network,
      roads: roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'longview-port-yard') })),
    });
    expect(
      placeItems(control, 1, pnwPlacesLayout(control, 1)).filter(
        (i) => i.kind === 'freight-shed' || i.kind === 'timber-deck',
      ),
    ).toEqual([]);
  });

  it('supports complete rigid footprints on rendered land and clears every road surface, including mirrored sites', () => {
    const road = createRoadNetwork({ network, roads });
    const layout = pnwPlacesLayout(road, 1);
    const scene = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
      seed: 1,
    });
    try {
      const ground = new GroundTris(scene.group, /^road-(land|shoulder)/);
      const items = placeItems(road, 1, layout);
      const yards = items.filter((i) => i.kind === 'freight-shed' || i.kind === 'timber-deck');
      expect(yards.length).toBeGreaterThan(1);
      expect(new Set(yards.map((i) => Math.sign(i.d))).size).toBe(2);
      let probes = 0;
      for (const item of yards) {
        item.geometry.computeBoundingBox();
        const bounds = item.geometry.boundingBox!;
        const spot = spotAt(road, item);
        const c = Math.cos(spot.turn),
          s = Math.sin(spot.turn);
        // A dense full box grid checks curved land and every other road; the anchor alone is insufficient.
        for (let x = bounds.min.x; x <= bounds.max.x + 0.5; x += 0.5)
          for (let z = bounds.min.z; z <= bounds.max.z + 0.5; z += 0.5) {
            const local = new Vector3(Math.min(x, bounds.max.x), 0, Math.min(z, bounds.max.z));
            const wx = spot.p.x + local.x * c + local.z * s;
            const wz = spot.p.z - local.x * s + local.z * c;
            const hit = ground.heightAt(wx, wz, spot.p.y + 1);
            expect(hit, `${item.kind} ${item.s} full footprint`).not.toBeNull();
            expect(Math.abs((hit?.y ?? Infinity) - spot.p.y)).toBeLessThan(0.4);
            expect(hit?.up ?? 0, 'the full footprint rests on level ground').toBeGreaterThan(0.9);
            for (const edge of road.edges) {
              // Every lane strip is sampled in its own world frame, so nearby edges cannot be hidden by project().
              for (let at = 0; at <= edge.length; at += 2) {
                const centre = road.toWorld(edge.index, at, 0, 0);
                if (Math.hypot(wx - centre.x, wz - centre.z) > 40) continue;
                const next = road.toWorld(edge.index, Math.min(edge.length, at + 1), 0, 0);
                const heading = Math.atan2(next.x - centre.x, next.z - centre.z);
                const across = (wx - centre.x) * Math.cos(heading) - (wz - centre.z) * Math.sin(heading);
                const along = (wx - centre.x) * Math.sin(heading) + (wz - centre.z) * Math.cos(heading);
                if (Math.abs(along) > 1.1) continue;
                expect(
                  across < edge.dMin - 0.4 || across > edge.dMax + 0.4,
                  `${item.kind} overlaps ${edge.id}`,
                ).toBe(true);
              }
            }
            probes++;
          }
      }
      console.log(
        `[examined] ${yards.length} rigid freight forms, ${probes} complete-footprint land/all-road probes`,
      );
    } finally {
      scene.dispose();
    }
  });
});
