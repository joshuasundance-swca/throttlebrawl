// San Francisco's Chinatown and North Beach (run W-U; the pitch deck's #8: "Chinatown and North Beach
// (lantern strings, awnings, cafe tables)"). The checks plan the real baked network and look at what
// stands where: the shopfronts on the sim's hard edge (so nothing drawn is an invisible wall and no
// rider rides into a wall that is not drawn), a near-continuous frontage broken only by the side
// streets, lantern strings across Chinatown's street only and high over every rider and shuttle,
// cafe tables only in North Beach and only behind the patio rail, the tower on the hill, and the
// phone's budget: a camera down the whole route draws a handful of meshes, the far stand-ins lighter.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { BlocksLayer, hasBlocks, NEAR_M, PATIO_M, planBlocks, type BlocksPlan } from './chinatown-northbeach';
import { createFlatLook } from './look';
import { networkTags, type RoadDressing } from './road-mesh';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const routeFiles = import.meta.glob<{ id: string; network: string; mainPath: string[] }>(
  '../../packs/*/regions/*/routes/*.json',
  { eager: true, import: 'default' },
);

function track(id: string): { road: RoadNetwork; dressing: RoadDressing; roads: BakedRoad[] } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing, roads };
}

const net = track('sf-chinatown-northbeach');
const plan: BlocksPlan = planBlocks({ road: net.road, dressing: net.dressing, seed: 7 });
const edgeId = (edge: number) => net.road.edges[edge]?.id ?? '';
const CHINATOWN_EDGES = new Set(['sf-cn-lantern-row', 'sf-cn-bell-grade']);
const hardEdge = (edge: number, side: -1 | 1, s: number) =>
  Math.abs(net.road.vergeAt(edge, s, side < 0 ? 'left' : 'right').dOuter);
const sideSpans = (edge: number) =>
  (net.roads.find((r) => r.id === edgeId(edge))?.tags ?? []).filter((t) => t.tag === 'side-street');

describe("San Francisco's Chinatown and North Beach: what stands along the streets", () => {
  it('draws only on this network, and needs no model file (a code-made kit, no download)', () => {
    const has = (id: string) => {
      const { road, dressing } = track(id);
      return hasBlocks(networkTags(road, dressing).tags);
    };
    expect(has('sf-chinatown-northbeach')).toBe(true);
    for (const other of ['sf-downtown', 'sf-hills', 'osm-sf-russian-hill', 'keys-m1', 'pnw-c1'])
      expect(has(other), other).toBe(false);
  });

  it('the fronts stand on the hard edge: the shopfronts at it, the cafes behind their patio rail', () => {
    const lanterns = plan.buildings.filter((b) => b.district === 'lanterns');
    const cafes = plan.buildings.filter((b) => b.district === 'cafes');
    print(
      `[examined] ${plan.buildings.length} buildings: ${lanterns.length} Chinatown, ${cafes.length} North Beach (${cafes.filter((b) => b.cafe).length} cafes), ${plan.buildings.filter((b) => b.district === 'side').length} on side streets`,
    );
    expect(lanterns.length).toBeGreaterThan(150);
    expect(cafes.length).toBeGreaterThan(110);
    for (const b of lanterns) {
      const edge = hardEdge(b.edge, b.side, (b.s0 + b.s1) / 2);
      expect(Math.abs(b.front - edge), `${edgeId(b.edge)} ${b.s0.toFixed(0)}`).toBeLessThan(0.05);
      expect(b.storeys).toBeGreaterThanOrEqual(3);
    }
    for (const b of cafes) {
      const edge = hardEdge(b.edge, b.side, (b.s0 + b.s1) / 2);
      expect(Math.abs(b.front - edge - PATIO_M)).toBeLessThan(0.05);
    }
  });

  it('a near-continuous frontage, broken only at the side streets', () => {
    let built = 0;
    let frontage = 0;
    for (const e of net.road.edges) {
      for (const side of [-1, 1] as const) {
        const mine = plan.buildings.filter(
          (b) =>
            b.edge === e.index && b.side === side && (b.district === 'lanterns' || b.district === 'cafes'),
        );
        built += mine.reduce((n, b) => n + (b.s1 - b.s0), 0);
        for (const b of mine) {
          for (const t of sideSpans(e.index)) {
            const overlap = Math.min(b.s1, t.s1) - Math.max(b.s0, t.s0);
            expect(overlap, `${e.id} ${b.s0.toFixed(0)} in a side street`).toBeLessThanOrEqual(0);
          }
        }
      }
    }
    // What the tags give the fronts: every 2 m of lanterns or cafes on each side.
    for (const r of net.roads) {
      for (let s = 0; s < r.lengthM; s += 2) {
        for (const side of ['left', 'right'] as const) {
          const on = (r.tags ?? []).some(
            (t) =>
              (t.tag === 'lanterns' || t.tag === 'cafes') &&
              s >= t.s0 &&
              s < t.s1 &&
              (t.side === side || t.side === 'both') &&
              !(r.tags ?? []).some(
                (x) =>
                  (x.tag === 'side-street' || x.tag === 'hill-park') &&
                  s >= x.s0 &&
                  s <= x.s1 &&
                  (x.side === side || x.side === 'both'),
              ),
          );
          if (on) frontage += 2;
        }
      }
    }
    print(
      `[examined] frontage built ${built.toFixed(0)} m of ${frontage} m (${((100 * built) / frontage).toFixed(1)} %)`,
    );
    expect(built / frontage).toBeGreaterThan(0.85);
  });

  it("lantern strings cross Chinatown's street only, high over every rider and shuttle", () => {
    const lanterns = plan.strings.reduce((n, s) => n + s.lanterns, 0);
    print(`[examined] ${plan.strings.length} lantern strings, ${lanterns} lanterns`);
    expect(plan.strings.length).toBeGreaterThan(80);
    for (const s of plan.strings) {
      const id = edgeId(s.edge);
      // Chinatown's roads, or the bend's lantern stretch before the districts' side street.
      expect(CHINATOWN_EDGES.has(id) || (id === 'sf-cn-crossover' && s.s < 185), `${id} ${s.s}`).toBe(true);
      expect(s.clearance).toBeGreaterThan(4.5);
      expect(s.lanterns).toBeGreaterThanOrEqual(8);
      for (const t of sideSpans(s.edge)) expect(s.s < t.s0 - 1 || s.s > t.s1 + 1, `${id} ${s.s}`).toBe(true);
    }
  });

  it('cafe tables only in North Beach, and only behind the patio rail where no rider reaches', () => {
    print(
      `[examined] ${plan.tables.length} patio tables, ${plan.trees} park trees, ${plan.sideStreets.length} side streets`,
    );
    expect(plan.tables.length).toBeGreaterThan(80);
    for (const t of plan.tables) {
      expect(CHINATOWN_EDGES.has(edgeId(t.edge)), edgeId(t.edge)).toBe(false);
      const side: -1 | 1 = t.d < 0 ? -1 : 1;
      expect(Math.abs(t.d) - hardEdge(t.edge, side, t.s)).toBeGreaterThan(1);
    }
    expect(plan.sideStreets.length).toBe(9);
    expect(plan.trees).toBeGreaterThan(40);
  });

  it('the tower stands on the hill past the finish, off the road', () => {
    expect(plan.tower).not.toBeNull();
    const e = net.road.edges.find((x) => x.id === 'sf-nb-overlook-climb');
    if (!e || !plan.tower) throw new Error('no tower');
    const finish = net.road.toWorld(e.index, 360, 0, 0);
    const dist = Math.hypot(plan.tower.x - finish.x, plan.tower.z - finish.z);
    print(
      `[examined] the tower ${dist.toFixed(0)} m from the finish line, its base ${plan.tower.y.toFixed(1)} m up`,
    );
    expect(dist).toBeGreaterThan(60);
    expect(dist).toBeLessThan(160);
    // Above the finish crest, so it reads over the climb.
    expect(plan.tower.y).toBeGreaterThan(finish.y);
  });

  it('repeats exactly for a seed, and a new seed changes the streets', () => {
    const again = planBlocks({ road: net.road, dressing: net.dressing, seed: 7 });
    const other = planBlocks({ road: net.road, dressing: net.dressing, seed: 8 });
    const sig = (p: BlocksPlan) =>
      p.buildings.map((b) => `${b.edge}:${b.s0.toFixed(2)}:${b.storeys}:${b.cafe}`).join(',');
    expect(sig(again)).toBe(sig(plan));
    expect(sig(other)).not.toBe(sig(plan));
  });

  it("the phone's budget: down the whole route a few meshes at a time, the far stand-ins lighter", () => {
    const route = Object.values(routeFiles).find((r) => r.id === 'sf-chinatown-northbeach-run');
    if (!route) throw new Error('no route');
    const layer = new BlocksLayer(look, { road: net.road, dressing: net.dressing, seed: 7 });
    let maxMeshes = 0;
    let maxTris = 0;
    let poses = 0;
    let prev: { x: number; z: number } | null = null;
    for (const id of route.mainPath) {
      const e = net.road.edges[net.road.edgeIndex(id)];
      if (!e) continue;
      const a = net.road.toWorld(e.index, 0, 0, 0);
      const b = net.road.toWorld(e.index, e.length, 0, 0);
      const fwd: boolean =
        !prev || Math.hypot(a.x - prev.x, a.z - prev.z) <= Math.hypot(b.x - prev.x, b.z - prev.z);
      for (let u = 0; u < e.length; u += 25) {
        const p = net.road.toWorld(e.index, fwd ? u : e.length - u, 0, 0);
        // Let the layer build what is near (one mesh a frame), as frames would.
        for (let i = 0; i < 30; i++) layer.update(p.x, p.z);
        const c = layer.counts();
        maxMeshes = Math.max(maxMeshes, c.meshes);
        maxTris = Math.max(maxTris, c.triangles);
        poses++;
      }
      prev = fwd ? b : a;
    }
    let nearTris = 0;
    let farTris = 0;
    for (const s of plan.near.values()) nearTris += s.pos.length / 9;
    for (const s of plan.far.values()) farTris += s.pos.length / 9;
    print(
      `[examined] ${poses} poses: at most ${maxMeshes} meshes and ${maxTris} triangles in range (before frustum culling); near detail ${Math.round(nearTris)} tris, far stand-ins ${Math.round(farTris)} tris over the network; near within ${NEAR_M} m`,
    );
    expect(poses).toBeGreaterThan(100);
    expect(maxMeshes).toBeLessThanOrEqual(12);
    // Before frustum culling; scene-cost.test.ts counts what the camera really draws.
    expect(maxTris).toBeLessThan(55_000);
    expect(farTris).toBeLessThan(nearTris * 0.4);
    layer.dispose();
  });
});
