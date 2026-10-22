import { readFileSync } from 'node:fs';
import { Mesh, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { boardCatalog } from '../../src/app/regions';
import { registryFromGlob } from '../../src/content';
import {
  createRoadNetwork,
  createRouteProgress,
  lanesUnderOf,
  readConnector,
  type BakedFeature,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { Boards, splitCopy, type BoardSlot } from '../../src/render/boards';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene } from '../../src/render/road-mesh';
import { LAND_TOP_M } from '../../src/render/scenery';
import source from './networks/osm-pnw-longview-civic.json';

const ROOT = 'packs/region-pnw/regions/pacific-northwest';
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${ROOT}/networks/${source.id}.json`);
const raw = network.roads.map((id) => read<BakedRoad & { realName?: string }>(`${ROOT}/roads/${id}.json`));
const route = read<BakedRoute>(`${ROOT}/routes/${source.routes[0]!.id}.json`);
const road = createRoadNetwork({ network, roads: raw });
const approach = raw.find((r) => r.id === route.start.road)!;
const branch = route.branches!.find((b) => b.marked)!;
const rows = network.junctions
  .flatMap((j) => j.connectors)
  .map(readConnector)
  .filter((r) => r !== null);
const split = rows.find(
  (r) => r.splitZone && r.from.road === approach.id && branch.roads.includes(r.to.road),
)!;
const rejoin = rows.find(
  (r) => !r.trafficOnly && branch.roads.includes(r.from.road) && route.mainPath.includes(r.to.road),
)!;
const splitS = split.splitZone!.s0;
const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const catalog = boardCatalog(reg, 'region-pnw:pacific-northwest');

function paired(features: readonly BakedFeature[], sign: string): (BoardSlot & { item: string }) | undefined {
  const slot = features.find(
    (f) =>
      f.kind === 'billboard' &&
      f.item &&
      !f.pool &&
      f.params?.['style'] === 'guide' &&
      f.s0 >= route.start.s &&
      f.s1 < splitS &&
      catalog.items[f.item]?.text === sign,
  );
  if (!slot?.item) return undefined;
  const { item, pool: _pool, ...rest } = slot;
  return { ...rest, item };
}

describe('Civic short-approach guide gives both choices equal headline treatment', () => {
  it('pairs actual recipe metadata, baked slot and a site-only vetoable catalog item before the fork', () => {
    const slot = paired(approach.features ?? [], branch.sign!);
    expect(slot, 'branch metadata needs an actual named guide board').toBeDefined();
    if (!slot) return;
    expect(branch.sign).toBe(source.branches.find((b) => b.id === branch.id)!.sign);
    const sourceApproach = source.lines.flatMap((line) => line.roads).find((r) => r.id === approach.id)! as {
      features?: readonly BakedFeature[];
    };
    expect(sourceApproach.features?.find((f) => f.id === slot.id)).toEqual(slot);
    const item = catalog.items[slot.item]!;
    expect(item.kind).toBe('sign');
    expect(catalog.pools?.signs?.some((entry) => entry.ref === item.ref)).toBe(false);
    expect(
      boardCatalog(reg, 'region-pnw:pacific-northwest', new Set([item.ref])).items[slot.item],
    ).toBeUndefined();
    const wrongItem = Object.keys(catalog.items).find((id) => catalog.items[id]!.text !== branch.sign)!;
    expect(wrongItem).toBeDefined();
    const controls: BakedFeature[][] = [
      (approach.features ?? []).filter((f) => f.id !== slot.id),
      (approach.features ?? []).map((f) => (f.id === slot.id ? { ...f, item: wrongItem } : f)),
      (approach.features ?? []).map((f) => (f.id === slot.id ? { ...f, s0: splitS, s1: splitS + 1 } : f)),
      (approach.features ?? []).map((f) => (f.id === slot.id ? { ...f, item: undefined, pool: 'signs' } : f)),
    ];
    for (const changed of controls)
      expect(paired(changed, branch.sign!), 'missing/wrong/moved/pooled controls').toBeUndefined();
  });

  it('derives both next-street cues from actual topology and keeps the longer warning in the same first sentence', () => {
    const ordinary = (ids: readonly string[]) =>
      ids
        .map((id) => raw.find((r) => r.id === id)!)
        .filter((r) => r.realName && !road.edges[road.edgeIndex(r.id)]!.isConnector);
    const mainRoads = ordinary(
      route.mainPath.slice(route.mainPath.indexOf(approach.id) + 1, route.mainPath.indexOf(rejoin.to.road)),
    );
    const altRoads = ordinary(branch.roads);
    const main = mainRoads[0]!;
    const alt = altRoads[0]!;
    const host = road.edges[road.edgeIndex(approach.id)]!;
    const f = road.frameAt(host.index, host.length);
    const cue = (id: string) => {
      const edge = road.edges[road.edgeIndex(id)]!;
      const g = road.frameAt(edge.index, Math.min(30, edge.length));
      const angle = (Math.atan2(-f.tz * g.tx + f.tx * g.tz, f.tx * g.tx + f.tz * g.tz) * 180) / Math.PI;
      process.stdout.write(
        `[examined] Civic ${id}: next-road heading ${angle.toFixed(2)} degrees from approach\n`,
      );
      return Math.abs(angle) < 20 ? 'STRAIGHT' : angle > 0 ? 'RIGHT' : 'LEFT';
    };
    const short = (name: string) => name.replace(/ (Street|Avenue|Boulevard|Way)$/, '').toUpperCase();
    const { headline, kicker } = splitCopy(branch.sign!);
    const clauses = headline.split(';');
    const mainWords = clauses.find((clause) => clause.includes(short(main.realName!)));
    const altWords = clauses.find((clause) => clause.includes(short(alt.realName!)));
    expect(mainWords, 'main direction belongs in the first-sentence headline').toContain(cue(main.id));
    expect(altWords, 'alternate direction belongs in that same headline').toContain(cue(alt.id));
    expect(mainWords).not.toBe(altWords);
    expect(altWords).toContain('LONGER');
    expect(kicker, 'retain the established headline plus short kicker format').not.toBe('');
    for (const street of [...mainRoads, ...altRoads]) expect(branch.sign).toContain(short(street.realName!));
    // Civic's physical rider connectors make the grid longer. Street-body lengths alone
    // discard those curves; use the same complete rider distance the race measures.
    const riderBranch = createRouteProgress(road, route).branchAt(road.edgeIndex(split.road))!;
    expect(riderBranch.choice?.toEdge).toBe(road.edgeIndex(split.road));
    expect(riderBranch.gainM, 'actual complete rider path, including ingress and exit').toBeLessThan(0);
    process.stdout.write(
      `[examined] Civic complete rider detour adds ${(-riderBranch.gainM).toFixed(4)} m including physical connectors\n`,
    );
    expect((split.splitZone!.d0 + split.splitZone!.d1) / 2).toBeGreaterThan(0);
  });

  it('retains a production guide whose post footprint clears every lane and recovery grass on actual drawn land', () => {
    const slot = paired(approach.features ?? [], branch.sign!);
    expect(slot).toBeDefined();
    if (!slot) return;
    const boards = new Boards(createFlatLook());
    const scene = buildRoadScene(road, createFlatLook(), Object.fromEntries(raw.map((r) => [r.id, r])), {
      roadsideDensity: 0,
    });
    try {
      boards.build(road, (id) => (id === approach.id ? [slot] : []), catalog);
      const view = boards.all().find((v) => v.slotId === slot.id)!;
      expect(view, 'production lane-clearance code must retain the board').toBeDefined();
      expect(view.style).toBe('guide');
      const frame = view.group.children.find((child) => child !== view.panel) as Mesh;
      const vertices = frame.geometry.getAttribute('position');
      const feet: Vector3[] = [];
      for (let i = 0; i < vertices.count; i++)
        if (Math.abs(vertices.getY(i)) < 1e-6)
          feet.push(new Vector3(vertices.getX(i), 0, vertices.getZ(i)).applyMatrix4(view.group.matrixWorld));
      expect(feet.length).toBeGreaterThan(0);
      const lands: Mesh[] = [];
      scene.group.updateMatrixWorld(true);
      scene.group.traverse((object) => {
        if (object instanceof Mesh && object.name === 'road-land') lands.push(object as Mesh);
      });
      expect(lands.length).toBeGreaterThan(0);
      const finder = lanesUnderOf(road);
      const edge = road.edges[road.edgeIndex(approach.id)]!;
      const ray = new Raycaster();
      for (const point of feet) {
        expect(
          finder.at(point.x, point.y, point.z, 7.5),
          'post corners clear all lanes plus recovery margin',
        ).toBeNull();
        const projected = road.project(point.x, point.z, edge.index);
        const verge = road.vergeAt(edge.index, projected.s, projected.d < 0 ? 'left' : 'right');
        expect(Math.abs(projected.d)).toBeGreaterThan(Math.abs(verge.dOuter) + 1.5);
        ray.set(new Vector3(point.x, point.y + 1, point.z), new Vector3(0, -1, 0));
        const hit = ray.intersectObjects(lands, false)[0];
        expect(hit, 'real road-land triangles support each post-foot corner').toBeDefined();
        // Existing boards stand at the road datum, while land is 9 cm below it. Bound that
        // inherited offset plus local grade and 2 mm interpolation, not exact foot contact.
        const gradeDelta = Math.abs(point.y - road.surfaceHeight(edge.index, projected.s, projected.d));
        expect(Math.abs(point.y - hit!.point.y + LAND_TOP_M)).toBeLessThan(gradeDelta + 0.002);
      }
      const lane = road.toWorld(edge.index, (slot.s0 + slot.s1) / 2, 2, 0);
      expect(finder.at(lane.x, lane.y, lane.z, 0.5), 'lane detection positive control').not.toBeNull();
      ray.set(new Vector3(lane.x + 10000, lane.y + 1, lane.z), new Vector3(0, -1, 0));
      expect(ray.intersectObjects(lands, false), 'real hole beyond the drawn land').toEqual([]);
      boards.build(road, () => [], catalog);
      expect(boards.all(), 'metadata alone creates no board').toEqual([]);
      process.stdout.write(
        `[examined] Civic guide center s${(slot.s0 + slot.s1) / 2}, start s${route.start.s}, fork s${splitS}; ${feet.length} foot vertices clear recovery and have actual land support; rendered readability pending\n`,
      );
    } finally {
      boards.clear();
      scene.dispose();
    }
  });
});
