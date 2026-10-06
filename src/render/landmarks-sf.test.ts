// San Francisco's landmark kits on their real roads (playtest 3, CX3): the committed Golden Gate and
// sf-landmarks GLBs, baked as the game bakes them, placed by the baked networks' own `landmark`
// features. landmarks.test.ts checks the layer's rules with fixture kits; this checks that the real
// kits meet those rules on the real data: every feature finds its kit and node through the asset
// manifest, the layer draws them in one call, and the deck the road bakes passes between each tower's
// legs at its real height there.
import { Color, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { buildSoup, roadPointsOf } from './backdrop/builder';
import type { BackdropNetworkFile, BackdropRegionFile } from './backdrop/data';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements, SUSPENSION } from './landmarks';
import { createFlatLook } from './look';
import { paintSurface, styleOfSurface, type SurfaceContext } from './text-surfaces';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';
import { bakeRepoModel } from './model-files.test-util';

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

// Playtest 4, P1 (the wave C check: "no suspender ropes"): the real kit's bays set where the ropes hang.
describe('the Golden Gate hangs suspender ropes on the real bridge', () => {
  it('draws a rope at every bay of both cables, in the one mesh, with the real kit', async () => {
    const road = track('osm-sf-golden-gate');
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    const ropePieces = layer.levels().filter((tiers) => tiers[0]?.[0] === SUSPENSION.ropeNearM);
    const triangles = ropePieces.reduce((n, tiers) => n + (tiers[0]?.[1] ?? 0), 0);
    // Two cables, a rope every bay (15.24 m) along the 1,960 m, less the stretch each tower's legs keep clear
    // and the ends where the cable meets the deck; a rope is a 3-sided tube, 6 triangles.
    const ropes = triangles / 6;
    stdout.write(`[examined] real Golden Gate: ${ropePieces.length} rope pieces, ${ropes} suspender ropes, ${triangles} near triangles
`);
    expect(ropes).toBeGreaterThan(2 * Math.floor(1960 / 15.24) * 0.8);
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes, 'ropes are in the one mesh').toBe(1);
  });
});

// Gate G2 (playtest 3): the Golden Gate route shows exactly one bridge. The near kit above draws it,
// so the far `golden-gate-bridge` backdrop piece must build nothing on that network. Its keep-out drops
// every slab within keepOutM of a road, and on this route that is every slab; if that ever changes (a
// shorter keep-out, a route off the bridge), this fails rather than drawing a second bridge. Control:
// from Lombard, which races nowhere near the bridge, the same piece still draws on the horizon.
// Playtest 4 (G1) brings a far bridge back to this route as its own network piece, `golden-gate-far`,
// with a near fade: it is never drawn nearer than the near fog's end, where the near kit is wholly in
// the fog. So on the route every far Golden Gate vertex must carry that fade (one bridge, never two).
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

  it("fades every far Golden Gate vertex on its route (G1), and none of the horizon's elsewhere", () => {
    const fadedOf = (id: string) => {
      const network = Object.entries(backdropNetworks).find(([k]) => k.endsWith(`/${id}.json`))?.[1];
      if (!network) throw new Error(`no backdrop for ${id}`);
      const keep = (p: { id: string }) => p.id.startsWith('golden-gate');
      const { soup } = buildSoup(
        { ...backdropRegion, pieces: backdropRegion.pieces.filter(keep) },
        { ...network, pieces: (network.pieces ?? []).filter(keep) },
        roadPointsOf(track(id).edges, 1),
        7,
      );
      const ring =
        buildSoup({ ...backdropRegion, pieces: [] }, { ...network, pieces: [] }, [], 7).soup.pos.length / 3;
      const verts = soup.fade.slice(ring);
      return { verts: verts.length, faded: verts.filter((f) => f > 0).length };
    };
    const onRoute = fadedOf('osm-sf-golden-gate');
    const fromLombard = fadedOf('osm-sf-lombard');
    stdout.write(
      `[examined] far Golden Gate vertices: ${onRoute.faded} of ${onRoute.verts} faded on its route; ${fromLombard.faded} of ${fromLombard.verts} from Lombard\n`,
    );
    expect(onRoute.verts).toBeGreaterThan(100);
    expect(onRoute.faded).toBe(onRoute.verts);
    expect(fromLombard.verts).toBeGreaterThan(100);
    expect(fromLombard.faded).toBe(0);
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
      // A node is found as the layer finds it: by its name, else as `<name>_lod0` (a node with levels of detail).
      for (const p of placements) {
        const nodes = kits.get(p.kit)?.nodes;
        expect(
          nodes?.has(p.node) || nodes?.has(`${p.node}_lod0`) || p.node === 'gg_bridge',
          `${p.feature.id}: ${p.kit}#${p.node}`,
        ).toBe(true);
      }
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

// Playtest 4, P1 (the wave C check: "the toll gantry's board is a blank dark panel"): the kit's board is
// a text surface, and a surface with no pack sign draws blank. The Golden Gate's region now has the sign.
describe("the toll gantry's board says something", () => {
  const regionFile = import.meta.glob<{
    signs?: { id: string; text: string; status?: string; tags?: string[] }[];
  }>('../../packs/region-sf/regions/san-francisco/region.json', { eager: true, import: 'default' });
  const signs = Object.values(regionFile)[0]?.signs ?? [];

  it("paints the pack sign on the placed board, facing a rider coming down the road, inside the board's cell", async () => {
    const road = track('osm-sf-golden-gate');
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    const board = layer.surfaces().find((s) => s.name === 'toll_gantry_sign');
    expect(board, 'the layer hands the gantry board to the text-surface layer').toBeDefined();
    if (!board) return;
    const sign = signs.find((x) => x.id === board.id);
    expect(sign, `a pack sign for ${board.name} (${board.id})`).toBeDefined();
    expect(sign?.status).toBe('live');
    expect(sign?.tags).toEqual(expect.arrayContaining(['new', 'surface', 'site']));
    expect(sign?.text.length ?? 0).toBeGreaterThan(0);
    // It faces back down the road: a rider travelling toward +s looks along +s at its face.
    const gantry = landmarkPlacements(road).find((p) => p.node === 'toll_gantry');
    if (!gantry) throw new Error('no gantry');
    const frame = road.frameAt(gantry.edge, (gantry.feature.s0 + gantry.feature.s1) / 2);
    const facing = board.normal.x * frame.tx + board.normal.z * frame.tz;
    expect(facing, 'the board faces the oncoming rider').toBeLessThan(-0.9);
    // Painted on its own cell, the words are green-board white and fit with a readable height.
    const calls: { text: string; size: number }[] = [];
    const ctx: SurfaceContext = {
      font: '',
      fillStyle: '',
      shadowColor: '',
      shadowBlur: 0,
      textAlign: 'left',
      textBaseline: 'alphabetic',
      fillRect() {},
      fillText(text) {
        calls.push({ text, size: Number(/(\d+)px/.exec(ctx.font)?.[1]) });
      },
      measureText(text) {
        return { width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 };
      },
    };
    const cell = { x: 0, y: 0, w: 1024, h: Math.round(1024 * (board.heightM / board.widthM)) };
    const fit = paintSurface(ctx, cell, styleOfSurface(board.name), sign?.text ?? '');
    stdout.write(
      `[examined] toll gantry board ${board.widthM} x ${board.heightM} m, "${sign?.text}": letters ${fit.size} px of a ${cell.h} px cell, facing ${facing.toFixed(2)}\n`,
    );
    expect(calls[0]?.text).toBe(sign?.text);
    expect(fit.size).toBeGreaterThanOrEqual(cell.h / 3);
    expect(styleOfSurface(board.name).bg).not.toBe(styleOfSurface('anything_else').bg);
  });
});

// Playtest 4, P1 (the wave C check: "Coit Tower never reads as a tower from Lombard"): at the circle on the
// hill it was a grey shaft cut off at the top of the frame, and from the flats the row houses hid it, since
// it stood 13 to 30 degrees off the road's line. It now stands where the flats' last straight runs at it.
// The check: from every camera along that straight, from 520 m out to 210 m (where its top leaves the
// frame), the tower is inside the picture (its top under the frame's top edge, its middle inside its width)
// and no row of houses hides more than half of it, the houses taken at their real height along both sides
// of the road, shoulder to shoulder (the worst the scatter can be).
describe('Coit Tower reads as a tower from Lombard (playtest 4, P1)', () => {
  const FRAME_UP_DEG = 26; // half the camera's 60 degree field, less its slight downward pitch
  const FRAME_ACROSS_DEG = 40; // half the width of a 16:9 frame, a little in
  const COIT_M = 64; // the model's height at scale 1 (sf_landmarks.py)

  type Pt = { x: number; y: number; z: number };

  async function houseRoofM(): Promise<number> {
    const houses = await bakeRepoModel('rowHouses');
    let top = 0;
    for (const g of houses.variants) {
      g.computeBoundingBox();
      top = Math.max(top, g.boundingBox?.max.y ?? 0);
    }
    return top;
  }

  /** How much of a tower of `heightM` standing at `base` a camera sees over the terrace, 0 to 1, and its top's elevation. */
  function visible(
    road: RoadNetwork,
    edge: number,
    cam: Pt,
    base: Pt,
    heightM: number,
    roofM: number,
  ): { share: number; topDeg: number } {
    const e = road.edges[edge];
    if (!e) throw new Error('no edge');
    // The terrace on each side: a front wall past the verge and a sidewalk (scenery.ts ACROSS_M), 11.5 m deep.
    const inner = e.dMax + 0.6 + 2.6;
    const outer = inner + 11.5;
    const heights = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((u) => u * heightM);
    let seen = 0;
    for (const h of heights) {
      const t = { x: base.x, y: base.y + h, z: base.z };
      const len = Math.hypot(t.x - cam.x, t.y - cam.y, t.z - cam.z);
      let blocked = false;
      // March to the tower's own footprint's edge (a house is never in it).
      for (let k = 4; k < len - 30 && !blocked; k += 4) {
        const u = k / len;
        const x = cam.x + (t.x - cam.x) * u;
        const y = cam.y + (t.y - cam.y) * u;
        const z = cam.z + (t.z - cam.z) * u;
        const d = Math.abs(road.project(x, z, edge).d);
        // The houses stand on the road's level there (the flats are flat to a few metres).
        if (d >= inner && d <= outer && y < cam.y - 2.6 + roofM) blocked = true;
      }
      if (!blocked) seen++;
    }
    return {
      share: seen / heights.length,
      topDeg:
        (Math.atan2(base.y + heightM - cam.y, Math.hypot(base.x - cam.x, base.z - cam.z)) * 180) / Math.PI,
    };
  }

  it('shows at least half the tower, inside the picture, along the whole last straight of the flats', async () => {
    const road = track('osm-sf-lombard');
    const kits = await kitsFor(road);
    const coit = landmarkPlacements(road).find((p) => p.node === 'coit_tower');
    expect(coit, 'Coit Tower is placed').toBeDefined();
    if (!coit) return;
    const node = kits.get('sf-landmarks')?.nodes.get('coit_tower');
    node?.geometry.computeBoundingBox();
    const modelTop = node?.geometry.boundingBox?.max.y ?? COIT_M;
    const heightM = modelTop * coit.scale;
    const roofM = await houseRoofM();
    const flats = road.edgeIndex('osm-sf-lombard-flats');
    expect(coit.edge, 'on the flats').toBe(flats);
    const sTower = (coit.feature.s0 + coit.feature.s1) / 2;
    const base: Pt = { x: coit.x, y: coit.y, z: coit.z };
    let worst = 1;
    let worstAt = 0;
    let checked = 0;
    let lowestTop = 90;
    for (let back = 520; back >= 210; back -= 10) {
      const s = sTower - back;
      if (s < 0) continue;
      const f = road.frameAt(flats, s);
      const p = road.toWorld(flats, s, 0, 0);
      const cam: Pt = { x: p.x - f.tx * 5, y: p.y + 2.6, z: p.z - f.tz * 5 };
      const { share, topDeg } = visible(road, flats, cam, base, heightM, roofM);
      // Inside the picture: its top under the frame's top, its middle within the frame's width.
      const bearing =
        (Math.atan2(
          (base.x - cam.x) * -f.tz + (base.z - cam.z) * f.tx,
          (base.x - cam.x) * f.tx + (base.z - cam.z) * f.tz,
        ) *
          180) /
        Math.PI;
      expect(topDeg, `${back} m out: its top`).toBeLessThan(FRAME_UP_DEG);
      expect(Math.abs(bearing), `${back} m out: its bearing`).toBeLessThan(FRAME_ACROSS_DEG);
      lowestTop = Math.min(lowestTop, topDeg);
      if (share < worst) {
        worst = share;
        worstAt = back;
      }
      checked++;
    }
    stdout.write(
      `[examined] Coit Tower ${heightM.toFixed(0)} m (scale ${coit.scale}) at s ${sTower.toFixed(0)} of the flats: ${checked} cameras from 520 m to 210 m out, houses ${roofM.toFixed(1)} m on both sides; the worst sees ${(worst * 100).toFixed(0)} % of it (${worstAt} m out)\n`,
    );
    expect(checked).toBeGreaterThan(25);
    expect(worst).toBeGreaterThanOrEqual(0.5);
  });

  it('finds the houses hiding a tower that stands off the road, where the old place was (the control)', async () => {
    const road = track('osm-sf-lombard');
    const flats = road.edgeIndex('osm-sf-lombard-flats');
    const roofM = await houseRoofM();
    // The old place: 13 to 30 degrees off the line of the flats' last 600 m, 150 m out to the side.
    const s = 960;
    const f = road.frameAt(flats, s);
    const p = road.toWorld(flats, s, 0, 0);
    const base: Pt = { x: p.x + f.tz * 150 + f.tx * 200, y: p.y + 25, z: p.z - f.tx * 150 + f.tz * 200 };
    let hidden = 0;
    let total = 0;
    for (let back = 520; back >= 210; back -= 30) {
      total++;
      const q = road.toWorld(flats, s - back, 0, 0);
      const g = road.frameAt(flats, s - back);
      const cam: Pt = { x: q.x - g.tx * 5, y: q.y + 2.6, z: q.z - g.tz * 5 };
      if (visible(road, flats, cam, base, COIT_M, roofM).share < 0.5) hidden++;
    }
    stdout.write(
      `[examined] a tower 13 to 30 degrees off the line: hidden (under half seen) from ${hidden} of ${total} cameras\n`,
    );
    expect(hidden).toBeGreaterThan(total / 2);
  });
});

// Playtest 4, P4-19 (G4; the run A check at deck s 389: "two big blank slabs (grey and beige) crowd both
// rails where the main cables end. They read as buildings, not anchorages"). The kit's anchorage is two
// 38 m concrete housings 8 m high on a 42 m apron. The bridge now draws each cable's anchorage in code
// (gg-anchorage.ts): a low stepped housing in the bridge's paint that the cable lands on.
describe('the Golden Gate cables end in anchorages, not blocks (playtest 4, G4)', () => {
  const road = track('osm-sf-golden-gate');
  const bridge = landmarkPlacements(road).find((p) => p.node === 'gg_bridge');
  if (!bridge) throw new Error('no bridge');
  const kitsP = kitsFor(road);

  /** One anchorage's vertices as the layer drew them: metres behind the cable entry, across, over the deck. */
  async function anchorageOf(end: 0 | 1) {
    const layer = new LandmarkLayer(await kitsP, look, { road });
    const mesh = layer.group.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const col = mesh.geometry.getAttribute('color');
    const nrm = mesh.geometry.getAttribute('normal');
    const s0 = end === 0 ? bridge!.feature.s0 : bridge!.feature.s1;
    // Along the approach, away from the span: +1 behind the entry.
    const behind = end === 0 ? -1 : 1;
    const o = road.toWorld(bridge!.edge, s0, 0, 0);
    const out: { a: number; x: number; y: number; r: number; g: number; b: number; ny: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i);
      const wz = pos.getZ(i);
      if (Math.hypot(wx - o.x, wz - o.z) > 90) continue;
      const p = road.project(wx, wz);
      if (p.edge !== bridge!.edge) continue;
      const a = (p.s - s0) * behind;
      // The housing stands behind the entry; the first bay and the cable's last tube stand ahead of it.
      if (a < 0.75) continue;
      out.push({
        a,
        x: p.d,
        y: pos.getY(i) - o.y,
        r: col.getX(i),
        g: col.getY(i),
        b: col.getZ(i),
        ny: nrm.getY(i),
      });
    }
    return out.filter((v) => v.y > -0.3);
  }

  it.each([0, 1] as const)(
    'end %i: stands low, short and clear of the lanes, in the bridge paint',
    async (end) => {
      const kits = await kitsP;
      const entry = kits.get('golden-gate')?.nodes.get('gg_anchorage')?.extras['cable_entry_m'] ?? 6;
      const v = await anchorageOf(end);
      expect(v.length, 'an anchorage above the deck').toBeGreaterThan(24);
      const high = Math.max(...v.map((p) => p.y));
      const length = Math.max(...v.map((p) => p.a));
      const inner = Math.min(...v.map((p) => Math.abs(p.x)));
      // The paint: the default bridge paint (#c0452f) or its shaded collar, never the kit's concrete.
      const paint = new Color('#c0452f');
      const isPaint = (p: { r: number; g: number; b: number }) => {
        const k = p.r / paint.r;
        return (
          k > 0.5 && k <= 1.001 && Math.abs(p.g - paint.g * k) < 0.02 && Math.abs(p.b - paint.b * k) < 0.02
        );
      };
      const upper = v.filter((p) => p.y > 1.2);
      const painted = upper.filter(isPaint).length / upper.length;
      // The steps: the heights of the housing's upward-facing tops, told apart to 0.4 m.
      const tops = [
        ...new Set(v.filter((p) => p.ny > 0.9 && p.y > 0.5).map((p) => Math.round(p.y * 2.5) / 2.5)),
      ];
      stdout.write(
        `[examined] anchorage ${end}: ${v.length} vertices over the deck; highest ${high.toFixed(1)} m (cable enters at ${entry} m), ${length.toFixed(1)} m long, inner face ${inner.toFixed(1)} m from the centre line, ${(painted * 100).toFixed(0)} % painted, ${tops.length} step tops\n`,
      );
      // Lower: nothing over the deck higher than the cable's saddle collar (the old blocks rose to 8 m).
      expect(high).toBeLessThanOrEqual(entry + 0.7);
      // Short: a housing, not a hall (the old ones were 38 m).
      expect(length).toBeLessThanOrEqual(24);
      // Clear of the lanes (the road is 27.6 m wide).
      expect(inner).toBeGreaterThanOrEqual(14.5);
      // The colour of the bridge, above the plinth.
      expect(painted).toBeGreaterThanOrEqual(0.8);
      // Stepped, so it reads as a structure the cable climbs onto.
      expect(tops.length).toBeGreaterThanOrEqual(3);
    },
  );
});
