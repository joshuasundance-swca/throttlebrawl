import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Color, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3, type BufferGeometry } from 'three';
import {
  createRoadNetwork,
  footContains,
  loadPnwPlacesLayout,
  lanesNear,
  dispatchCourts,
  dispatchCourtClear,
  fixtureNetwork,
  planStreetFurniture,
  structureLayersFor,
  type BakedNetwork,
  type BakedRoad,
} from '../road';
import { GroundTris } from './land-probe.test-util';
import { createFlatLook } from './look';
import { hasPnwPlaces, placeItems, spotAt } from './pnw-places';
import { buildRoadScene } from './road-mesh';
import { PNW_KIT, scatterRoadside } from './roadside';
import { SCENERY_RADIUS_M } from './scenery';

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
  it('reserves the exact court footprint from real scenery and physical furniture, with removed/displaced controls', () => {
    const civic = Object.values(networks).find((n) => n.id === 'osm-pnw-longview-civic')!;
    const roads = Object.values(files).filter((r) => civic.roads.includes(r.id));
    const road = createRoadNetwork({ network: civic, roads }),
      dressing = Object.fromEntries(roads.map((r) => [r.id, r]));
    const feet = dispatchCourts(road).map((c) => c.foot);
    expect(feet.length).toBeGreaterThan(0);
    const bare = buildRoadScene(road, createFlatLook(), dressing, { seed: 1, reservedFootprints: [] });
    const scenes = [bare];
    try {
      const candidate = bare.spots.find((p) => dispatchCourtClear(feet, p.p.x, p.p.z, 20));
      expect(candidate, 'real built-in scenery candidate').toBeDefined();
      if (!candidate) return;
      const moved = [{ ...feet[0]!, x: candidate.p.x, z: candidate.p.z }];
      const shifted = buildRoadScene(road, createFlatLook(), dressing, {
        seed: 1,
        reservedFootprints: moved,
      });
      const actual = buildRoadScene(road, createFlatLook(), dressing, { seed: 1, reservedFootprints: feet });
      scenes.push(shifted, actual);
      expect(
        shifted.spots.some((p) => p.edge === candidate.edge && p.s === candidate.s && p.d === candidate.d),
      ).toBe(false);
      expect(
        bare.spots.some((p) => p === candidate),
        'removal restores actual candidate',
      ).toBe(true);
      expect(
        actual.spots.every((p) => dispatchCourtClear(feet, p.p.x, p.p.z, SCENERY_RADIUS_M[p.kind] * p.size)),
      ).toBe(true);
      const input = {
        road,
        dressing,
        seed: 1,
        density: 1,
        kit: PNW_KIT,
        spots: [],
        landReach: (e: number, side: -1 | 1, s: number) => bare.landReach(e, side, s),
      };
      const loose = scatterRoadside({ ...input, reservedFootprints: [] });
      const looseCandidate = loose.find(
        (p) =>
          !PNW_KIT.rules.find((r) => r.id === p.rule)?.discBack && dispatchCourtClear(feet, p.p.x, p.p.z, 20),
      );
      expect(looseCandidate, 'real roadside-kit candidate').toBeDefined();
      if (!looseCandidate) return;
      const displaced = [{ ...feet[0]!, x: looseCandidate.p.x, z: looseCandidate.p.z }];
      const kept = scatterRoadside({ ...input, reservedFootprints: displaced });
      expect(
        kept.some(
          (p) => p.rule === looseCandidate.rule && p.s === looseCandidate.s && p.d === looseCandidate.d,
        ),
      ).toBe(false);
      const ordinary = road.toWorld(dispatchCourts(road)[0]!.edge, dispatchCourts(road)[0]!.s, 2, 0);
      expect(dispatchCourtClear(feet, ordinary.x, ordinary.z, 1), 'ordinary lane is not reserved').toBe(true);
      const fitted = scatterRoadside({ ...input, reservedFootprints: feet });
      expect(
        fitted.every((p) => {
          const rule = PNW_KIT.rules.find((r) => r.id === p.rule)!;
          const c = road.toWorld(p.edge, p.s, p.d + Math.sign(p.d) * (rule.discBack ?? 0), 0);
          return dispatchCourtClear(feet, c.x, c.z, rule.r * (rule.run ? 1 : (rule.size?.[1] ?? 1)));
        }),
      ).toBe(true);

      // Actual physical-planner candidate on a controlled paved plaza, using the same generic kit tag.
      const bundle = fixtureNetwork([{ id: 'plaza', lengthM: 180, kappa: 0 }]);
      const plaza: BakedRoad = {
        ...bundle.roads[0]!,
        tags: [{ tag: 'plaza', side: 'both', s0: 0, s1: 180 }],
        laneSections: bundle.roads[0]!.laneSections.map((section) => ({
          ...section,
          verges: {
            left: { widthM: 1, surface: 'concrete', edge: 'soft' },
            right: { widthM: 1, surface: 'concrete', edge: 'soft' },
          },
        })),
      };
      const plain = createRoadNetwork({ network: bundle.network, roads: [plaza] });
      const before = planStreetFurniture(plain, 1).items;
      const target = before.find(
        (p) =>
          p.d > plain.vergeAt(p.edge, p.s, 'right').dOuter + 1 &&
          p.d < plain.vergeAt(p.edge, p.s, 'right').dOuter + 7 &&
          p.s > 8 &&
          p.s < 124,
      )!;
      expect(target, 'actual physical furniture candidate').toBeDefined();
      const placed = (at: number) =>
        createRoadNetwork({
          network: bundle.network,
          roads: [
            {
              ...plaza,
              tags: [...plaza.tags!, { tag: 'dispatch-court', side: 'right', s0: at - 8, s1: at + 8 }],
            },
          ],
        });
      const occupied = placed(target.s),
        movedRoad = placed(target.s + 48);
      const after = planStreetFurniture(occupied, 1).items;
      const same = (p: typeof target) => p.rule === target.rule && p.s === target.s && p.d === target.d;
      expect(after.some(same), 'physical candidate removed').toBe(false);
      expect(
        planStreetFurniture(movedRoad, 1).items.some(same),
        'displaced tag restores original physical candidate',
      ).toBe(true);
      expect(before.some(same), 'removed tag restores physical candidate').toBe(true);
      const geometry = (items: typeof before) => items.filter((p) => p.d < 0).map(({ id: _id, ...p }) => p);
      expect(geometry(after), 'ordinary opposite-side placement unchanged').toEqual(geometry(before));
      process.stdout.write(
        `[examined] scenery ${bare.spots.length}/${actual.spots.length}, roadside ${loose.length}/${fitted.length}, physical furniture ${before.length}/${after.length}; removal and displacement controls effective\n`,
      );
    } finally {
      for (const scene of scenes) scene.dispose();
    }
  });
  it('does not add or reshape any road land on either side, with actual zone-land positive control', () => {
    const civic = Object.values(networks).find((n) => n.id === 'osm-pnw-longview-civic')!;
    const raw = Object.values(files).filter((r) => civic.roads.includes(r.id));
    function groundHash(mode: 'authored' | 'absent' | 'zone') {
      const roads = raw.map((r) => ({
        ...r,
        tags: mode === 'authored' ? r.tags : r.tags?.filter((t) => t.tag !== 'dispatch-court'),
        features:
          mode === 'authored'
            ? r.features
            : r.features?.filter((f) => f.params?.['place'] !== 'dispatch-court'),
      }));
      if (mode === 'zone') {
        const host = roads.find((r) => r.id === 'osm-longview-civic-hudson')!;
        host.features = [
          ...(host.features ?? []),
          { kind: 'roadsideZone', id: 'ground-control', s0: 40, s1: 56, d0: 11.25, d1: 19.25 },
        ];
      }
      const road = createRoadNetwork({ network: civic, roads });
      const scene = buildRoadScene(road, createFlatLook(), Object.fromEntries(roads.map((r) => [r.id, r])), {
        seed: 1,
      });
      const hash = createHash('sha256');
      let examined = 0;
      try {
        scene.group.updateMatrixWorld(true);
        scene.group.traverse((o) => {
          if (!(o instanceof Mesh) || !/^road-(land|shoulder)/.test(o.name)) return;
          hash.update(o.name);
          hash.update(JSON.stringify(o.matrixWorld.elements));
          const geometry = o.geometry as BufferGeometry;
          const p = geometry.getAttribute('position');
          for (let i = 0; i < p.count; i++) hash.update(`${p.getX(i)},${p.getY(i)},${p.getZ(i)};`);
          if (geometry.index) hash.update(JSON.stringify(Array.from(geometry.index.array)));
          examined += p.count;
        });
        expect(examined).toBeGreaterThan(0);
        return hash.digest('hex');
      } finally {
        scene.dispose();
      }
    }
    const absent = groundHash('absent');
    expect(groundHash('zone'), 'zone adds real land outside the explicit site').not.toBe(absent);
    expect(groundHash('authored'), 'pure tag leaves all underlying road ground identical').toBe(absent);
  });
  it('grounds the Hudson court and actual prop feet on existing land, with open body clearance and authored drawing controls', () => {
    const civic = Object.values(networks).find((n) => n.id === 'osm-pnw-longview-civic')!;
    const civicRoads = Object.values(files).filter((r) => civic.roads.includes(r.id));
    const road = createRoadNetwork({ network: civic, roads: civicRoads });
    const site = pnwPlacesLayout(road, 1).streetSites.find((s) => String(s.kind) === 'dispatch-court');
    expect(site).toBeDefined();
    if (!site) return;
    const withoutZone = civicRoads.map((r) => ({
      ...r,
      tags: r.tags?.filter((t) => t.tag !== 'dispatch-court'),
    }));
    const control = createRoadNetwork({ network: civic, roads: withoutZone });
    const scene = buildRoadScene(
      control,
      createFlatLook(),
      Object.fromEntries(withoutZone.map((r) => [r.id, r])),
      { seed: 1 },
    );
    const ground = new GroundTris(scene.group, /^road-(land|shoulder)/);
    const item = placeItems(road, 1, pnwPlacesLayout(road, 1)).find((i) => i.kind === 'dispatch-court')!;
    const spot = spotAt(road, item),
      c = Math.cos(spot.turn),
      s = Math.sin(spot.turn);
    const world = (x: number, z: number) => ({ x: spot.p.x + x * c + z * s, z: spot.p.z - x * s + z * c });
    try {
      const pos = item.geometry.getAttribute('position');
      const matches = (shift: number) =>
        Array.from({ length: pos.count }, (_, i) => {
          const p = world(pos.getX(i) + shift, pos.getZ(i)),
            y = spot.p.y + pos.getY(i);
          return site.specs.some(
            (st) =>
              footContains({ ...st.foot, hu: st.foot.hu + 0.025, hv: st.foot.hv + 0.025 }, p.x, p.z) &&
              y >= st.baseY - 0.025 &&
              y <= st.baseY + (st.roof.kind === 'flat' ? st.roof.topM : 0) + 0.025,
          );
        }).every(Boolean);
      expect(pos.count).toBeGreaterThan(0);
      expect(matches(0), 'drawing matches physical boxes').toBe(true);
      expect(matches(1), 'displaced drawing negative').toBe(false);
      let probes = 0;
      const apron = site.specs.find((st) => st.rule.endsWith(':apron'))!;
      let minGround = Infinity,
        maxGround = -Infinity;
      for (const st of site.specs) {
        const f = st.foot,
          nx = Math.max(1, Math.ceil((2 * f.hu) / 0.5)),
          nz = Math.max(1, Math.ceil((2 * f.hv) / 0.5));
        for (let i = 0; i <= nx; i++)
          for (let j = 0; j <= nz; j++) {
            const u = (2 * i) / nx - 1,
              v = (2 * j) / nz - 1;
            const x = f.x + u * f.hu * f.ux - v * f.hv * f.uz,
              z = f.z + u * f.hu * f.uz + v * f.hv * f.ux;
            const hit = ground.heightAt(x, z, spot.p.y + 1);
            expect(hit, `${st.rule} preexisting land`).not.toBeNull();
            expect(hit?.up ?? 0).toBeGreaterThan(0.9);
            minGround = Math.min(minGround, hit!.y);
            maxGround = Math.max(maxGround, hit!.y);
            expect(Math.abs((hit?.y ?? Infinity) - spot.p.y)).toBeLessThan(0.25);
            const floor = apron.baseY + (apron.roof.kind === 'flat' ? apron.roof.topM : 0);
            expect(floor - (hit?.y ?? Infinity), 'apron visible above existing ground').toBeGreaterThan(0);
            expect(floor - (hit?.y ?? -Infinity)).toBeLessThan(0.15);
            expect(lanesNear(road, x, z, site.edge, 0.4), `${st.rule} other-road lanes`).toBe(false);
            const own = road.project(x, z, site.edge);
            expect(own.d, 'clear of Hudson lanes').toBeGreaterThan(road.edges[site.edge]!.dMax + 0.4);
            if (st !== apron) {
              const at = road.project(x, z, site.edge),
                verge = road.vergeAt(site.edge, at.s, 'right');
              expect(at.d, 'ordinary recovery margin').toBeGreaterThan(verge.dOuter + 0.4);
            }
            probes++;
          }
      }
      // Every front-edge station overlaps the actual curved verge: no inviting strip of unridable town grass.
      for (let z = -apron.foot.hv; z <= apron.foot.hv; z += 0.25) {
        const p = world(site.solids.find((st) => st.name === 'apron')!.box.x1, z);
        const at = road.project(p.x, p.z, site.edge),
          verge = road.vergeAt(site.edge, at.s, 'right');
        expect(at.d, 'continuous apron/verge connection').toBeLessThanOrEqual(verge.dOuter);
      }
      // A broad open sweep admits several bike-width lines; dressing never forms a timed slalom.
      const points = [
        [-6, 13],
        [-2, 14],
        [2, 14],
        [6, 13],
      ];
      let clearanceProbes = 0;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!,
          n = Math.ceil(Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!) / 0.2);
        const yaw = Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!);
        for (let j = 0; j <= n; j++)
          for (const across of [-0.6, 0, 0.6])
            for (const along of [-1.2, 0, 1.2]) {
              const localS =
                  a[0]! + ((b[0]! - a[0]!) * j) / n + along * Math.cos(yaw) - across * Math.sin(yaw),
                d = a[1]! + ((b[1]! - a[1]!) * j) / n + across * Math.cos(yaw) + along * Math.sin(yaw);
              const p = world(site.d - d, localS);
              expect(footContains(apron.foot, p.x, p.z), 'entire bike supported').toBe(true);
              expect(
                site.specs.filter(
                  (st) =>
                    st !== apron &&
                    footContains({ ...st.foot, hu: st.foot.hu + 0.05, hv: st.foot.hv + 0.05 }, p.x, p.z),
                ),
                'no solid in riding envelope',
              ).toEqual([]);
              clearanceProbes++;
            }
      }
      // Removing the authoring removes the drawing; moving it moves drawing and its contact frame together.
      expect(
        placeItems(control, 1, pnwPlacesLayout(control, 1)).some((i) => i.kind === 'dispatch-court'),
      ).toBe(false);
      const moved = createRoadNetwork({
        network: civic,
        roads: civicRoads.map((r) => ({
          ...r,
          tags: r.tags?.map((t) => (t.tag === 'dispatch-court' ? { ...t, s0: t.s0 - 16, s1: t.s1 - 16 } : t)),
        })),
      });
      const movedSite = pnwPlacesLayout(moved, 1).streetSites.find(
        (s) => String(s.kind) === 'dispatch-court',
      )!;
      const movedItem = placeItems(moved, 1, pnwPlacesLayout(moved, 1)).find(
        (i) => i.kind === 'dispatch-court',
      )!;
      expect(movedItem.s).toBe(movedSite.s);
      expect(
        Math.hypot(spotAt(moved, movedItem).p.x - spot.p.x, spotAt(moved, movedItem).p.z - spot.p.z),
      ).toBeGreaterThan(10);
      const left = createRoadNetwork({
        network: civic,
        roads: civicRoads.map((r) => ({
          ...r,
          tags: r.tags?.map((t) => (t.tag === 'dispatch-court' ? { ...t, side: 'left' as const } : t)),
        })),
      });
      const leftLayout = pnwPlacesLayout(left, 1);
      const leftSite = leftLayout.streetSites.find((s) => s.kind === 'dispatch-court')!;
      const leftItem = placeItems(left, 1, leftLayout).find((i) => i.kind === 'dispatch-court')!;
      try {
        expect(leftItem.d).toBe(leftSite.d);
        expect(leftItem.d).toBeLessThan(0);
        const leftSpot = spotAt(left, leftItem);
        expect(Math.hypot(leftSpot.p.x - spot.p.x, leftSpot.p.z - spot.p.z)).toBeGreaterThan(20);
        for (const st of leftSite.specs)
          expect(
            left.project(st.foot.x, st.foot.z, leftSite.edge).d,
            'all physical pieces move to the authored side',
          ).toBeLessThan(0);
        const leftApron = leftSite.specs.find((st) => st.rule.endsWith(':apron'))!;
        expect(leftApron.foot.x).toBe(leftSpot.p.x);
        expect(leftApron.foot.z).toBe(leftSpot.p.z);
      } finally {
        leftItem.geometry.dispose();
      }
      const otherEdge = road.edges.find((e) => e.id === 'osm-longview-civic-20th')!;
      const positive = road.toWorld(otherEdge.index, otherEdge.length / 2, 0, 0);
      expect(lanesNear(road, positive.x, positive.z, site.edge, 0.4)).toBe(true);
      expect(ground.heightAt(1e6, 1e6)).toBeNull();
      process.stdout.write(
        `[examined] Hudson ${probes} complete-footprint preexisting-land probes, ${clearanceProbes} bike-envelope probes, preexisting height span=${maxGround - minGround}m\n`,
      );
      movedItem.geometry.dispose();
    } finally {
      item.geometry.dispose();
      scene.dispose();
    }
  });
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
