import { describe, expect, it } from 'vitest';
import { Color, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
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
const network = Object.values(networks).find((n) => n.id === 'osm-pnw-longview-diamond')!;
const roads = Object.values(files).filter((r) => network.roads.includes(r.id));
const { pnwPlacesLayout } = await loadPnwPlacesLayout();
const isSite = (kind: string) => kind === 'civic-frontage' || kind === 'plant-market';

describe('Street Diamond has distinct, physically grounded local life on its arms', () => {
  it('reads the service frontage from the road with an upright R first and S last', () => {
    const road = createRoadNetwork({ network, roads });
    const item = placeItems(road, 1, pnwPlacesLayout(road, 1)).find((i) => i.kind === 'civic-frontage')!;
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const mesh = new Mesh(item.geometry, material);
    const ray = new Raycaster();
    const ink = new Color('#e6dfca');
    const colours = item.geometry.getAttribute('color');
    // View the road-facing facade from +X. Screen-right runs toward -Z.
    const cell = 0.18,
      width = (7 * 4 - 1) * cell;
    const read = (letter: number) =>
      Array.from({ length: 5 }, (_, row) =>
        Array.from({ length: 3 }, (_, column) => {
          const z = 5 + width / 2 - (letter * 4 + column + 0.5) * cell;
          ray.set(new Vector3(5, 4.3 + (4 - row + 0.5) * cell, z), new Vector3(-1, 0, 0));
          const hit = ray.intersectObject(mesh)[0];
          if (!hit?.face) return '0';
          const colour = new Color().fromBufferAttribute(colours, hit.face.a);
          return Math.abs(colour.r - ink.r) + Math.abs(colour.g - ink.g) + Math.abs(colour.b - ink.b) < 0.01
            ? '1'
            : '0';
        }).join(''),
      );
    try {
      expect(read(0)).toEqual(['110', '101', '110', '101', '101']);
      expect(read(6)).toEqual(['011', '100', '010', '001', '110']);
    } finally {
      material.dispose();
    }
  });
  it('loads authored civic frontage and plant-market forms only on their selected streets', () => {
    const road = createRoadNetwork({ network, roads });
    expect(structureLayersFor(road)).toContain('pnw-places');
    expect(hasPnwPlaces(new Set(['longview-street-life']))).toBe(true);
    const items = placeItems(road, 1, pnwPlacesLayout(road, 1));
    expect(
      items.some(
        (i) => i.kind === 'civic-frontage' && road.edges[i.edge]?.id === 'osm-longview-diamond-20th',
      ),
    ).toBe(true);
    expect(
      items.some(
        (i) => i.kind === 'plant-market' && road.edges[i.edge]?.id === 'osm-longview-diamond-kessler',
      ),
    ).toBe(true);
    for (const controlRoads of [
      roads.map((r) => ({ ...r, tags: r.tags?.filter((t) => t.tag !== 'longview-street-life') })),
      roads.map((r) => ({ ...r, features: r.features?.filter((f) => !isSite(String(f.params?.['place']))) })),
    ]) {
      const control = createRoadNetwork({ network, roads: controlRoads });
      expect(placeItems(control, 1, pnwPlacesLayout(control, 1)).filter((i) => isSite(i.kind))).toEqual([]);
    }
  });

  it('matches every rendered solid vertex to physical volume and detects a displaced model', () => {
    const road = createRoadNetwork({ network, roads });
    const layout = pnwPlacesLayout(road, 1);
    const sites = layout.streetSites ?? [];
    expect(sites.length).toBeGreaterThan(0);
    const items = placeItems(road, 1, layout);
    for (const site of sites) {
      const item = items.find((i) => i.kind === site.kind && i.s === site.s && i.d === site.d)!;
      const pos = item.geometry.getAttribute('position'),
        spot = spotAt(road, item);
      const c = Math.cos(spot.turn),
        s = Math.sin(spot.turn);
      const matches = (shift: number) => {
        for (let i = 0; i < pos.count; i++) {
          const x = spot.p.x + pos.getX(i) * c + pos.getZ(i) * s + shift;
          const z = spot.p.z - pos.getX(i) * s + pos.getZ(i) * c;
          const y = spot.p.y + pos.getY(i);
          if (
            !site.specs.some(
              (st) =>
                footContains({ ...st.foot, hu: st.foot.hu + 0.025, hv: st.foot.hv + 0.025 }, x, z) &&
                y >= st.baseY - 0.025 &&
                y <= st.baseY + (st.roof.kind === 'flat' ? st.roof.topM : st.roof.ridgeM) + 0.025,
            )
          )
            return false;
        }
        return true;
      };
      expect(pos.count).toBeGreaterThan(0);
      expect(matches(0), site.kind).toBe(true);
      expect(matches(1), 'displaced model control').toBe(false);
    }
  });

  it('keeps full rigid footprints on existing land with site zones removed, off all roads and clear of the grass recovery band', () => {
    const road = createRoadNetwork({ network, roads });
    const layout = pnwPlacesLayout(road, 1);
    const sites = layout.streetSites ?? [];
    expect(sites.length).toBeGreaterThan(0);
    // A site zone draws land itself. Remove those features before proving pre-existing support.
    const controlRoads = roads.map((r) => ({
      ...r,
      features: r.features?.filter((f) => !isSite(String(f.params?.['place']))),
    }));
    const control = createRoadNetwork({ network, roads: controlRoads });
    const scene = buildRoadScene(
      control,
      createFlatLook(),
      Object.fromEntries(controlRoads.map((r) => [r.id, r])),
      { seed: 1 },
    );
    const ground = new GroundTris(scene.group, /^road-(land|shoulder)/);
    const roadSamples = road.edges.flatMap((e) =>
      Array.from({ length: Math.ceil(e.length / 2) + 1 }, (_, i) => {
        const s = Math.min(e.length, i * 2),
          a = road.toWorld(e.index, s, 0, 0),
          frame = road.frameAt(e.index, s);
        return { edge: e.id, a, tx: frame.tx, tz: frame.tz, lo: e.dMin, hi: e.dMax };
      }),
    );
    try {
      let probes = 0;
      for (const site of sites)
        for (const st of site.specs) {
          const f = st.foot;
          const offsets = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];
          for (const u of offsets)
            for (const v of offsets) {
              const x = f.x + u * f.hu * f.ux - v * f.hv * f.uz,
                z = f.z + u * f.hu * f.uz + v * f.hv * f.ux;
              const anchor = road.toWorld(site.edge, site.s, site.d, 0);
              const hit = ground.heightAt(x, z, anchor.y + 1);
              expect(hit, `${st.rule} existing ground`).not.toBeNull();
              expect(Math.abs((hit?.y ?? Infinity) - anchor.y)).toBeLessThan(0.35);
              expect(hit?.up ?? 0).toBeGreaterThan(0.9);
              for (const sample of roadSamples) {
                const dx = x - sample.a.x,
                  dz = z - sample.a.z;
                if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
                const along = dx * sample.tx + dz * sample.tz;
                if (Math.abs(along) > 1.1) continue;
                const across = -dx * sample.tz + dz * sample.tx;
                expect(
                  across < sample.lo - 0.4 || across > sample.hi + 0.4,
                  `${st.rule} overlaps ${sample.edge}`,
                ).toBe(true);
              }
              if (!st.rule.endsWith(':apron')) {
                const at = road.project(x, z, site.edge),
                  verge = road.vergeAt(site.edge, at.s, site.d < 0 ? 'left' : 'right');
                expect(Math.abs(at.d), `${st.rule} recovery margin`).toBeGreaterThan(
                  Math.abs(verge.dOuter) + 0.4,
                );
              }
              probes++;
            }
        }
      expect(ground.heightAt(1e6, 1e6)).toBeNull();
      console.log(`[examined] ${sites.length} sites, ${probes} entire-box existing-ground/all-road probes`);
    } finally {
      scene.dispose();
    }
  });
});
