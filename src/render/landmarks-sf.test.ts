// San Francisco's landmark kits on their real roads (playtest 3, CX3): the committed Golden Gate and
// sf-landmarks GLBs, baked as the game bakes them, placed by the baked networks' own `landmark`
// features. landmarks.test.ts checks the layer's rules with fixture kits; this checks that the real
// kits meet those rules on the real data: every feature finds its kit and node through the asset
// manifest, the layer draws them in one call, and the deck the road bakes passes between each tower's
// legs at its real height there.
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { buildSoup, roadPointsOf } from './backdrop/builder';
import type { BackdropNetworkFile, BackdropRegionFile } from './backdrop/data';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements, SUSPENSION } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-sf/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-sf/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): RoadNetwork {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return createRoadNetwork({ network, roads });
}

async function kitsFor(road: RoadNetwork): Promise<Map<LandmarkKitId, LandmarkKit>> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const rows = assetIndex(createPackLibrary().registry());
  const kits = new Map<LandmarkKitId, LandmarkKit>();
  for (const id of landmarkKitsFor(road)) {
    const row = rows.find((r) => r.id === landmarkKitAsset(id));
    expect(row, `${id}: an asset manifest row`).toBeDefined();
    if (!row) continue;
    const buf = fs.readFileSync(`packs/${row.packId}/assets/${row.id}.glb`);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    kits.set(id, bakeLandmarkKit(id, readGlb(data)));
  }
  return kits;
}

describe('the Golden Gate kit on the baked bridge', () => {
  it('draws the bridge in one call, and the real deck passes between the legs at each tower', async () => {
    const road = track('osm-sf-golden-gate');
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    expect(layer.counts().skipped).toBe(0);
    expect(layer.counts().placed).toBeGreaterThan(0);

    const bridge = landmarkPlacements(road).find((p) => p.node === 'gg_bridge');
    expect(bridge).toBeDefined();
    if (!bridge) return;
    const f = bridge.feature;
    const tower = kits.get('golden-gate')?.nodes.get('gg_tower_lod0');
    expect(tower).toBeDefined();
    if (!tower) return;
    const pos = tower.geometry.getAttribute('position');
    // The deck's corridor at a tower, in the tower's own frame (origin at the waterline, +Z along the
    // road): the road's width, from a metre under its surface to 5 m over it (a truck and a rider).
    const halfW = 13.8;
    for (const s of [f.s0 + SUSPENSION.sideSpanM, f.s1 - SUSPENSION.sideSpanM]) {
      layer.update(road.toWorld(bridge.edge, s, 0, 0).x, road.toWorld(bridge.edge, s, 0, 0).z);
      const c = layer.counts();
      expect(c.drawCalls).toBe(1);
      expect(c.nearPieces).toBeGreaterThan(0);
      const deckY = road.toWorld(bridge.edge, s, 0, 0).y;
      let hits = 0;
      for (let i = 0; i < pos.count; i += 3) {
        const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)];
        const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
        // A triangle's box overlapping the corridor counts (stricter than the triangle itself).
        if (
          Math.max(...xs) > -halfW &&
          Math.min(...xs) < halfW &&
          Math.max(...ys) > deckY - 1 &&
          Math.min(...ys) < deckY + 5
        )
          hits++;
      }
      stdout.write(
        `[examined] tower at s ${s.toFixed(0)}: deck ${deckY.toFixed(1)} m, ${pos.count / 3} tower triangles, ${hits} in the deck corridor; ${c.trianglesDrawn} triangles drawn\n`,
      );
      expect(hits).toBe(0);
    }
  });
});

// Gate G2 (playtest 3): the Golden Gate route shows exactly one bridge. The near kit above draws it,
// so the far `golden-gate-bridge` backdrop piece must build nothing on that network. Its keep-out drops
// every slab within keepOutM of a road, and on this route that is every slab; if that ever changes (a
// shorter keep-out, a route off the bridge), this fails rather than drawing a second bridge. Control:
// from Lombard, which races nowhere near the bridge, the same piece still draws on the horizon.
const backdropRegion = import.meta.glob<BackdropRegionFile>(
  '../../packs/region-sf/assets/backdrop/san-francisco/region.json',
  {
    eager: true,
    import: 'default',
  },
)['../../packs/region-sf/assets/backdrop/san-francisco/region.json']!;
const backdropNetworks = import.meta.glob<BackdropNetworkFile>(
  '../../packs/region-sf/assets/backdrop/san-francisco/networks/*.json',
  { eager: true, import: 'default' },
);

function farBridgeTriangles(id: string): number {
  const network = Object.entries(backdropNetworks).find(([k]) => k.endsWith(`/${id}.json`))?.[1];
  if (!network) throw new Error(`no backdrop for ${id}`);
  const points = roadPointsOf(track(id).edges, 1);
  const only = (ids: string[]) => ({
    ...backdropRegion,
    pieces: backdropRegion.pieces.filter((p) => ids.includes(p.id)),
  });
  const withBridge = buildSoup(only(['golden-gate-bridge']), network, points, 7).stats.triangles;
  const without = buildSoup(only([]), network, points, 7).stats.triangles;
  return withBridge - without;
}

describe('one Golden Gate on its route (gate G2)', () => {
  it('builds no far backdrop bridge where the near kit draws, and keeps it on the horizon elsewhere', () => {
    expect(landmarkPlacements(track('osm-sf-golden-gate')).some((p) => p.node === 'gg_bridge')).toBe(true);
    const onRoute = farBridgeTriangles('osm-sf-golden-gate');
    const fromLombard = farBridgeTriangles('osm-sf-lombard');
    stdout.write(
      `[examined] far golden-gate-bridge triangles: ${onRoute} on its route, ${fromLombard} from Lombard\n`,
    );
    expect(onRoute).toBe(0);
    expect(fromLombard).toBeGreaterThan(0);
    expect(landmarkPlacements(track('osm-sf-lombard')).some((p) => p.node === 'gg_bridge')).toBe(false);
  });
});

describe('Coit Tower on Telegraph Hill', () => {
  it('finds its kit and node and draws in one call near the finish', async () => {
    const road = track('osm-sf-lombard');
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    const coit = landmarkPlacements(road).find((p) => p.node === 'coit_tower');
    expect(coit).toBeDefined();
    expect(layer.counts().skipped).toBe(0);
    expect(layer.counts().placed).toBeGreaterThan(0);
    if (!coit) return;
    layer.update(coit.x + 50, coit.z);
    expect(layer.counts().drawCalls).toBe(1);
    expect(layer.counts().nearPieces).toBeGreaterThan(0);
  });
});

// The far bridge's own list (gate G2, made explicit): the `golden-gate-bridge` piece names the networks
// that draw it, and a network whose road carries a near `gg_bridge` is not among them, so the route
// shows one bridge whatever the piece's keep-out does. The rule runs over every San Francisco network,
// so a new one has to choose: with a near bridge it stays off the list; without, it is on it.
describe('the far Golden Gate piece names exactly the networks without a near bridge', () => {
  it('lists every San Francisco network that places no gg_bridge, and none that does', () => {
    const piece = backdropRegion.pieces.find((p) => p.id === 'golden-gate-bridge');
    expect(piece?.networks, 'the piece lists its networks').toBeDefined();
    const listed = new Set(piece?.networks ?? []);
    const networks = Object.values(networkFiles).map((n) => n.id);
    expect(networks.length).toBeGreaterThan(1);
    const nearBridge = (id: string): boolean => {
      const net = Object.values(networkFiles).find((n) => n.id === id);
      return Object.values(roadFiles).some(
        (r) =>
          net?.roads.includes(r.id) === true &&
          (r.features ?? []).some(
            (f) => f.kind === 'landmark' && String(f.params?.['model']).endsWith('#gg_bridge'),
          ),
      );
    };
    const withNear = networks.filter(nearBridge);
    expect(withNear, 'a near bridge exists on some network').not.toHaveLength(0);
    for (const id of networks)
      expect(listed.has(id), `${id}: ${nearBridge(id) ? 'near' : 'far'}`).toBe(!nearBridge(id));
    stdout.write(
      `[examined] ${networks.length} San Francisco networks: ${withNear.join(', ')} place a near bridge and are off the far piece's list; ${listed.size} others draw it\n`,
    );
  });
});

// The toll gantry (CX3's `sf-landmarks#toll_gantry`) over the toll plaza's road. It is an overRoad
// landmark, so the road lint lets it stand across the lanes; this checks what the lint cannot: that
// the placed model's posts stand outside the road's drawn width and its beam clears every rider.
describe('the toll gantry over the toll plaza', () => {
  const RIDER_CLEAR_M = 5.5; // a rider on a bike, with margin; a truck is 4 m
  const halfWidth = (road: BakedRoad): number => {
    let half = 0;
    for (const sec of road.laneSections)
      for (const lane of sec.lanes) half = Math.max(half, Math.abs(lane.dCenterM) + lane.widthM / 2);
    return half;
  };

  it('finds its kit and node, stands centred on the road, and keeps the lanes clear', async () => {
    const road = track('osm-sf-golden-gate');
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    expect(layer.counts().skipped).toBe(0);
    const gantry = landmarkPlacements(road).find((p) => p.node === 'toll_gantry');
    expect(gantry, 'the toll gantry is placed').toBeDefined();
    if (!gantry) return;
    expect(gantry.params.overRoad).toBe(true);
    const bakedRoad = Object.values(roadFiles).find((r) => r.id === road.edges[gantry.edge]?.id);
    expect(bakedRoad?.id).toBe('osm-sf-gg-toll-plaza');
    if (!bakedRoad) return;
    const half = halfWidth(bakedRoad);
    // Centred on the road: the box's middle is the road's axis, so the posts mirror each other.
    expect(Math.abs((gantry.feature.d0 + gantry.feature.d1) / 2)).toBeLessThan(0.5);
    const node = kits.get('sf-landmarks')?.nodes.get('toll_gantry');
    expect(node).toBeDefined();
    if (!node) return;
    const pos = node.geometry.getAttribute('position');
    const sMid = (gantry.feature.s0 + gantry.feature.s1) / 2;
    expect(Math.abs(road.toWorld(gantry.edge, sMid, 0, 0).y - gantry.y)).toBeLessThan(0.01);
    let inLanes = 0;
    let posts = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (y < RIDER_CLEAR_M && Math.abs(x) < half) inLanes++;
      if (y < 1 && Math.abs(x) >= half) posts++;
    }
    stdout.write(
      `[examined] toll gantry over a ${(half * 2).toFixed(1)} m road at s ${sMid.toFixed(0)}: ${pos.count} vertices, ${inLanes} below ${RIDER_CLEAR_M} m inside the lanes, ${posts} post-foot vertices outside them\n`,
    );
    expect(inLanes).toBe(0);
    expect(posts).toBeGreaterThan(0);

    // Near it, the layer draws the gantry and the bridge in one call.
    layer.update(gantry.x, gantry.z);
    expect(layer.counts().drawCalls).toBe(1);
    expect(layer.counts().nearPieces).toBeGreaterThan(0);
  });
});

// Every San Francisco landmark, on its real baked road: each feature names a node its kit has, and
// all of a network's landmarks draw in one call, inside the plan's triangle cap for a landmark view.
describe('every San Francisco landmark resolves and draws within the landmark caps', () => {
  const LANDMARK_DRAW_CAP = 3; // the plan's cap on landmark draws in a view; the aim is 1
  const LANDMARK_TRIANGLE_CAP = 18_000; // the plan's bridge-kit cap (real-world L3a), the largest landmark
  const withLandmarks = Object.values(networkFiles).filter((n) =>
    Object.values(roadFiles).some(
      (r) => n.roads.includes(r.id) && (r.features ?? []).some((f) => f.kind === 'landmark'),
    ),
  );

  it('has landmark networks to check', () => {
    const ids = withLandmarks.map((n) => n.id);
    expect(ids).toContain('osm-sf-golden-gate');
    expect(ids).toContain('osm-sf-lombard');
  });

  it.each(withLandmarks.map((n) => n.id))(
    '%s: every landmark finds its node, and one call draws them',
    async (id) => {
      const road = track(id);
      const kits = await kitsFor(road);
      const placements = landmarkPlacements(road);
      expect(placements.length).toBeGreaterThan(0);
      for (const p of placements)
        expect(
          kits.get(p.kit)?.nodes.has(p.node) || p.node === 'gg_bridge',
          `${p.feature.id}: ${p.kit}#${p.node}`,
        ).toBe(true);
      const layer = new LandmarkLayer(kits, look, { road });
      expect(layer.counts().placed).toBe(placements.length);
      expect(layer.counts().skipped).toBe(0);
      let worst = 0;
      for (const p of placements) {
        layer.update(p.x, p.z);
        const c = layer.counts();
        expect(c.drawCalls).toBeLessThanOrEqual(LANDMARK_DRAW_CAP);
        expect(c.drawCalls, `${p.feature.id}: aims for one draw call`).toBe(1);
        worst = Math.max(worst, c.trianglesDrawn);
      }
      stdout.write(
        `[examined] ${id}: ${placements.length} landmarks, one draw call in each view, worst view ${worst} triangles\n`,
      );
      expect(worst).toBeLessThanOrEqual(LANDMARK_TRIANGLE_CAP);
    },
  );
});
