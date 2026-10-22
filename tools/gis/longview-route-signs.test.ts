// Street Diamond needs a real approach guide-board slot, not only branch metadata.
// This is deliberately scoped to its recipe; other routes gain no automatic signs.
import { Mesh, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { registryFromGlob } from '../../src/content';
import { boardCatalog } from '../../src/app/regions';
import {
  createRoadNetwork,
  lanesUnderOf,
  readConnector,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { Boards, splitCopy, type BoardSlot } from '../../src/render/boards';
import { createFlatLook } from '../../src/render/look';
import { buildRoadScene } from '../../src/render/road-mesh';
import { LAND_TOP_M } from '../../src/render/scenery';

interface Recipe {
  id: string;
  lines: { id: string; roads: { id: string; features?: BoardSlot[] }[] }[];
  branches: { id: string; marked?: boolean; sign?: string }[];
  routes: { id: string; startRoad: string }[];
}
const recipes = Object.values(
  import.meta.glob<Recipe>('./networks/osm-pnw-longview-diamond.json', {
    eager: true,
    import: 'default',
  }),
);
const networks = Object.values(
  import.meta.glob<BakedNetwork>(
    '/packs/region-pnw/regions/pacific-northwest/networks/osm-pnw-longview-*.json',
    { eager: true, import: 'default' },
  ),
);
const roads = Object.values(
  import.meta.glob<BakedRoad & { realName?: string }>(
    '/packs/region-pnw/regions/pacific-northwest/roads/*longview*.json',
    { eager: true, import: 'default' },
  ),
);
const routes = Object.values(
  import.meta.glob<BakedRoute>('/packs/region-pnw/regions/pacific-northwest/routes/*longview*.json', {
    eager: true,
    import: 'default',
  }),
);
const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const catalog = boardCatalog(reg, 'region-pnw:pacific-northwest');

/** Find this authored choice's named slot. A moved, missing or pooled replacement is not a match. */
function paired(slots: readonly BoardSlot[], sign: string, splitS: number) {
  return slots.find(
    (s) =>
      s.kind === 'billboard' &&
      s.item &&
      s.params?.['style'] === 'guide' &&
      s.s0 >= 0 &&
      s.s1 < splitS &&
      splitCopy(catalog.items[s.item]?.text ?? '').headline === splitCopy(sign).headline,
  );
}

describe('Longview approach directions are authored, resolvable and physically placed', () => {
  it('examines the selected recipes rather than silently matching no files', () => {
    expect(recipes.length).toBeGreaterThan(0);
    for (const recipe of recipes) expect(recipe.branches.some((b) => b.marked)).toBe(true);
  });
  describe.each(recipes)('$id', (recipe) => {
    const network = networks.find((n) => n.id === recipe.id)!;
    const raw = roads.filter((r) => network.roads.includes(r.id));
    const road = createRoadNetwork({ network, roads: raw });
    const route = routes.find((r) => r.id === recipe.routes[0]!.id)!;
    const approach = raw.find((r) => r.id === route.start.road)!;
    const branch = route.branches!.find((b) => b.marked)!;
    const split = network.junctions
      .flatMap((j) => j.connectors.map(readConnector))
      .find(
        (c) =>
          c &&
          !c.trafficOnly &&
          c.splitZone &&
          c.from.road === approach.id &&
          branch.roads.includes(c.to.road),
      )!;
    const splitS = split.splitZone!.s0;
    const sourceApproach = recipe.lines.flatMap((l) => l.roads).find((r) => r.id === approach.id)!;

    const choices = () => branch.sign!.split(/(?<=[.!?])\s+/).filter((clause) => clause.trim());

    it('gives each actual choice its own full headline on a canonical and baked site-only guide before the split', () => {
      expect(branch.sign).toBeTruthy();
      expect(branch.sign).toBe(recipe.branches.find((b) => b.id === branch.id)?.sign);
      const clauses = choices();
      const slots = clauses.map((clause) => paired(approach.features ?? [], clause, splitS));
      for (const [i, clause] of clauses.entries()) {
        const slot = slots[i];
        expect(slot, 'every direction needs a full headline, never only a secondary kicker').toBeDefined();
        if (!slot) continue;
        expect(sourceApproach.features?.find((f) => f.id === slot.id)).toEqual(slot);
        expect(approach.tags?.some((t) => t.tag === 'town')).toBe(true);
        const item = catalog.items[slot.item!]!;
        expect(item.kind).toBe('sign');
        expect(catalog.pools?.signs?.some((i) => i.ref === item.ref)).toBe(false);
        expect(
          boardCatalog(reg, 'region-pnw:pacific-northwest', new Set([item.ref])).items[slot.item!],
        ).toBeUndefined();
        for (const changed of [
          (approach.features ?? []).filter((f) => f !== slot),
          (approach.features ?? []).map((f) => (f === slot ? { ...f, item: 'missing-direction-item' } : f)),
          (approach.features ?? []).map((f) => (f === slot ? { ...f, s0: splitS, s1: splitS + 1 } : f)),
          (approach.features ?? []).map((f) => (f === slot ? { ...f, item: undefined, pool: 'signs' } : f)),
        ])
          expect(
            paired(changed, clause, splitS),
            'missing, wrong, moved and pooled controls',
          ).toBeUndefined();
      }
      expect(new Set(slots.map((slot) => slot?.id)).size).toBe(clauses.length);
      for (let i = 1; i < slots.length; i++)
        expect(slots[i]?.s0, 'separate reading positions in the authored choice order').toBeGreaterThan(
          slots[i - 1]!.s1,
        );
    });

    it('names the main and alternate streets with cues derived from the actual split geometry and discloses the longer route', () => {
      const ordinary = (ids: readonly string[]) =>
        ids
          .map((id) => raw.find((r) => r.id === id)!)
          .filter((r) => r.realName && !road.edges.find((e) => e.id === r.id)!.isConnector);
      const rejoin = network.junctions
        .flatMap((j) => j.connectors.map(readConnector))
        .find(
          (c) =>
            c && !c.trafficOnly && branch.roads.includes(c.from.road) && route.mainPath.includes(c.to.road),
        )!;
      const mainRoads = ordinary(
        route.mainPath.slice(route.mainPath.indexOf(approach.id) + 1, route.mainPath.indexOf(rejoin.to.road)),
      );
      const altRoads = ordinary(branch.roads);
      const main = mainRoads[0]!;
      const alt = altRoads[0]!;
      const short = (name: string) => name.replace(/ (Street|Avenue|Boulevard|Way)$/, '').toUpperCase();
      const zone = split.splitZone!;
      const side = (zone.d0 + zone.d1) / 2;
      const host = road.edges.find((e) => e.id === approach.id)!;
      const f = road.frameAt(host.index, host.length);
      const cue = (id: string) => {
        const e = road.edges.find((e) => e.id === id)!;
        const g = road.frameAt(e.index, Math.min(30, e.length));
        const angle = (Math.atan2(-f.tz * g.tx + f.tx * g.tz, f.tx * g.tx + f.tz * g.tz) * 180) / Math.PI;
        console.info(
          `[examined] ${recipe.id} ${id}: outgoing heading ${angle.toFixed(2)} degrees from approach`,
        );
        return Math.abs(angle) < 20 ? 'STRAIGHT' : angle > 0 ? 'RIGHT' : 'LEFT';
      };
      const alternateCue = cue(alt.id);
      const mainCue = cue(main.id);
      const sign = branch.sign!;
      const choices = sign.split('.').filter((x) => x.trim());
      const mainWords = choices.find((x) => x.includes(short(main.realName!)));
      const altWords = choices.find((x) => x.includes(short(alt.realName!)));
      expect(mainWords).toContain(mainCue);
      expect(altWords).toContain(alternateCue);
      expect(altWords).toContain('LONGER');
      for (const r of mainRoads) expect(mainWords).toContain(short(r.realName!));
      for (const r of altRoads) expect(altWords).toContain(short(r.realName!));
      expect(altRoads.reduce((m, r) => m + r.lengthM, 0)).toBeGreaterThan(
        mainRoads.reduce((m, r) => m + r.lengthM, 0),
      );
      // Check the actual outgoing roads, not an assumption based on the course's name.
      const start = road.toWorld(host.index, host.length, 0, 0);
      const across = (id: string) => {
        const e = road.edges.find((e) => e.id === id)!;
        const p = road.toWorld(e.index, Math.min(30, e.length), 0, 0);
        return -(p.x - start.x) * f.tz + (p.z - start.z) * f.tx;
      };
      expect(Math.sign(across(alt.id) - across(main.id))).toBe(Math.sign(side));
    });

    it('builds every choice guide with low parts past recovery grass, clear of all lanes and supported by actual drawn land', () => {
      const slots = choices().map((clause) => {
        const slot = paired(approach.features ?? [], clause, splitS);
        expect(slot, 'each choice must resolve independently').toBeDefined();
        return slot!;
      });
      const boards = new Boards(createFlatLook());
      const scene = buildRoadScene(road, createFlatLook(), Object.fromEntries(raw.map((r) => [r.id, r])), {
        roadsideDensity: 0,
      });
      try {
        boards.build(road, (id) => (id === approach.id ? slots : []), catalog);
        expect(boards.all().map((view) => view.slotId)).toEqual(slots.map((slot) => slot.id));
        for (const slot of slots) {
          const view = boards.all().find((v) => v.slotId === slot.id)!;
          expect(view, 'the production lane-clearance check must retain the board').toBeDefined();
          expect(view.style).toBe('guide');
          const frame = view.group.children.find((o) => o !== view.panel) as Mesh;
          const vertices = frame.geometry.getAttribute('position');
          const feet = [];
          for (let i = 0; i < vertices.count; i++)
            if (Math.abs(vertices.getY(i)) < 1e-6) {
              feet.push(
                new Vector3(vertices.getX(i), 0, vertices.getZ(i)).applyMatrix4(view.group.matrixWorld),
              );
            }
          expect(feet.length).toBeGreaterThan(0);
          const lands: Mesh[] = [];
          scene.group.updateMatrixWorld(true);
          scene.group.traverse((o) => {
            if (o instanceof Mesh && o.name === 'road-land') lands.push(o as Mesh);
          });
          expect(lands.length).toBeGreaterThan(0);
          const finder = lanesUnderOf(road);
          const edge = road.edges.find((e) => e.id === approach.id)!;
          const ray = new Raycaster();
          for (const p of feet) {
            expect(
              finder.at(p.x, p.y, p.z, 7.5),
              'every post-foot corner clears every lane, its six-metre grass band and recovery margin',
            ).toBeNull();
            const projected = road.project(p.x, p.z, edge.index);
            const verge = road.vergeAt(edge.index, projected.s, projected.d < 0 ? 'left' : 'right');
            expect(Math.abs(projected.d)).toBeGreaterThan(Math.abs(verge.dOuter) + 1.5);
            ray.set(new Vector3(p.x, p.y + 1, p.z), new Vector3(0, -1, 0));
            const hit = ray.intersectObjects(lands, false)[0];
            expect(hit, 'post has actual land triangles under it').toBeDefined();
            // Boards use the road datum; legacy land is LAND_TOP_M below it. Account for
            // grade across the toed-in post footprint and 2 mm of mesh interpolation precision.
            // This bounds the inherited datum gap; it does not claim exact post/ground contact.
            const gradeDelta = Math.abs(p.y - road.surfaceHeight(edge.index, projected.s, projected.d));
            expect(Math.abs(p.y - hit!.point.y + LAND_TOP_M)).toBeLessThan(gradeDelta + 0.002);
          }
          // Positive control for lane detection and a real hole outside the land surface.
          const lane = road.toWorld(edge.index, (slot.s0 + slot.s1) / 2, 2, 0);
          expect(finder.at(lane.x, lane.y, lane.z, 0.5)).not.toBeNull();
          ray.set(new Vector3(lane.x + 10000, lane.y + 1, lane.z), new Vector3(0, -1, 0));
          expect(ray.intersectObjects(lands, false)).toEqual([]);
          console.info(
            `[examined] ${recipe.id}: board s${(slot.s0 + slot.s1) / 2}, split s${splitS}, route start s${route.start.s}; ${feet.length} post-foot vertices on drawn land outside recovery band`,
          );
        }
        boards.build(road, () => [], catalog);
        expect(boards.all(), 'marked branch metadata alone still creates no automatic boards').toEqual([]);
      } finally {
        boards.clear();
        scene.dispose();
      }
    });
  });
});
