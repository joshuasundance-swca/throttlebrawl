// Portland's landmark kit on its real road (playtest 3, CX4): the committed pdx-landmarks GLB, baked
// as the game bakes it, placed by Bridge City's own `landmark` features (the Hawthorne lift towers,
// T9.4). landmarks.test.ts checks the layer's rules with fixture kits; this checks that the real kit
// meets them on the real data: every feature finds its kit and node through the asset manifest, the
// layer draws them in one call, and the deck the road bakes passes between each tower's legs.
import { AdditiveBlending, Color, type Mesh, type MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { GLOW, LandmarkLayer, landmarkKitsFor, landmarkPlacements, RAIN_CLOUD } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/region-pnw/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/region-pnw/regions/*/roads/*.json', {
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

/** How far the road's lanes (sidewalks and shoulders included) reach from its centreline at s, m. */
function halfWidth(road: RoadNetwork, edge: number, s: number): number {
  const lanes = road.lanesAt(edge, s);
  expect(lanes.length, 'lanes at the tower').toBeGreaterThan(0);
  return Math.max(...lanes.map((l) => Math.abs(l.dCenterM) + l.widthM / 2));
}

describe('the Hawthorne lift towers on Bridge City', () => {
  it('finds the kit and node for every Portland landmark feature and draws them in one call', async () => {
    const road = track('osm-pnw-portland');
    const towers = landmarkPlacements(road).filter((p) => p.kit === 'pdx-landmarks');
    expect(towers.length, 'Bridge City names pdx-landmarks features').toBeGreaterThan(0);
    const kits = await kitsFor(road);
    const layer = new LandmarkLayer(kits, look, { road });
    expect(layer.counts().skipped).toBe(0);
    expect(layer.counts().placed).toBe(landmarkPlacements(road).length);
    const first = towers[0]!;
    layer.update(first.x + 30, first.z);
    // One call for the lit mesh, and a second while the roof sign's neon glow is in range (playtest 4,
    // P1); the plan's cap for a landmark view is 3.
    expect(layer.counts().drawCalls).toBeGreaterThanOrEqual(1);
    expect(layer.counts().drawCalls).toBeLessThanOrEqual(2);
    expect(layer.counts().nearPieces).toBeGreaterThan(0);
  });

  it('keeps every tower triangle out of the deck corridor, from under the deck to a truck high', async () => {
    const road = track('osm-pnw-portland');
    const kits = await kitsFor(road);
    const kit = kits.get('pdx-landmarks');
    expect(kit, 'the pdx-landmarks kit').toBeDefined();
    if (!kit) return;
    for (const at of landmarkPlacements(road).filter((p) => p.node.startsWith('pdx_lift_tower'))) {
      const s = (at.feature.s0 + at.feature.s1) / 2;
      const halfW = halfWidth(road, at.edge, s);
      for (const name of ['pdx_lift_tower_lod0', 'pdx_lift_tower_lod1']) {
        const node = kit.nodes.get(name);
        expect(node, name).toBeDefined();
        if (!node) continue;
        const pos = node.geometry.getAttribute('position');
        // The node's own frame: origin on the deck's centreline at the road surface, +Z along the
        // road. The corridor is the road's width, from 1.5 m under its surface (the deck the road
        // lane draws) to 6 m over it (a truck and a rider in the air).
        let hits = 0;
        for (let i = 0; i < pos.count; i += 3) {
          const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)];
          const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
          if (
            Math.max(...xs) > -halfW &&
            Math.min(...xs) < halfW &&
            Math.max(...ys) > -1.5 &&
            Math.min(...ys) < 6
          )
            hits++;
        }
        stdout.write(
          `[examined] ${at.feature.id ?? '?'} ${name}: half-width ${halfW} m, ${pos.count / 3} triangles, ${hits} in the deck corridor\n`,
        );
        expect(hits, `${name} at ${at.feature.id ?? '?'}`).toBe(0);
      }
    }
  });
});

// Playtest 4, P1 (the wave C check: "the neon salmon is a thin dark outline"): the roof sign's neon
// strokes (its salmon and the frame round its board) draw as light. The node's `neon` vertices leave the
// lit mesh for a second, unlit and additive one: a bright core and a dimmer halo shell stood out from it.
describe('the roof sign glows (playtest 4, P1)', () => {
  it('draws the neon strokes unlit and additive, as a core and a halo, in one more call; the rest stays lit', async () => {
    const road = track('osm-pnw-portland');
    const kits = await kitsFor(road);
    const kit = kits.get('pdx-landmarks');
    const sign = landmarkPlacements(road).find((p) => p.node === 'pdx_roof_sign');
    const node = kit?.nodes.get('pdx_roof_sign');
    expect(sign && node, 'the roof sign and its node').toBeTruthy();
    if (!sign || !node) return;
    const neon = node.roles.filter((r) => r.role === 'neon').reduce((n, r) => n + r.count, 0);
    expect(neon, "the node's neon vertices").toBeGreaterThan(30);

    const layer = new LandmarkLayer(kits, look, { road });
    layer.update(sign.x + 40, sign.z);
    const glow = layer.group.children.find((o) => o.name === 'landmarks-glow') as Mesh | undefined;
    expect(glow, 'a glow mesh').toBeDefined();
    if (!glow) return;
    expect(layer.counts().drawCalls, 'the lit mesh and the glow').toBe(2);
    const material = glow.material as MeshBasicMaterial;
    expect(material.isMeshBasicMaterial, 'unlit').toBe(true);
    expect(material.blending).toBe(AdditiveBlending);
    expect(material.depthWrite).toBe(false);

    // Core, then halo: the halo is the same stroke stood GLOW.shellM out along its normals, dimmer.
    const pos = glow.geometry.getAttribute('position');
    const col = glow.geometry.getAttribute('color');
    expect(pos.count, 'a core and a halo for every neon vertex').toBe(2 * neon);
    let moved = 0;
    for (let i = 0; i < neon; i++) {
      const core = new Vector3().fromBufferAttribute(pos, i);
      const halo = new Vector3().fromBufferAttribute(pos, neon + i);
      moved += Math.abs(core.distanceTo(halo) - GLOW.shellM) < 0.01 ? 1 : 0;
    }
    expect(moved, 'every halo vertex stands the shell width off its core').toBe(neon);
    const light = (i: number) => col.getX(i) + col.getY(i) + col.getZ(i);
    expect(light(0), 'the core is brighter than the halo').toBeGreaterThan(light(neon) * 1.5);

    const lit = layer.group.children.find((o) => o.name === 'landmarks') as Mesh;
    const litCount = lit.geometry.getAttribute('position').count;
    expect(litCount, 'the building and the board stay in the lit mesh').toBeGreaterThan(0);
    stdout.write(
      `[examined] roof sign: ${neon} neon vertices -> ${pos.count} in the glow mesh (core + halo, ${GLOW.shellM} m shell), ${litCount} vertices stay in the lit mesh; ${layer.counts().drawCalls} draw calls in view\n`,
    );
  });

  it('adds no call where no neon is in range (the control: a view of a lift tower)', async () => {
    const road = track('osm-pnw-portland');
    const kits = await kitsFor(road);
    const tower = landmarkPlacements(road).find((p) => p.node.startsWith('pdx_lift_tower'));
    const sign = landmarkPlacements(road).find((p) => p.node === 'pdx_roof_sign');
    expect(tower && sign).toBeTruthy();
    if (!tower || !sign) return;
    const layer = new LandmarkLayer(kits, look, { road });
    // Past the mid reach of the sign, so none of its pieces is in the index.
    layer.update(tower.x, tower.z);
    expect(Math.hypot(tower.x - sign.x, tower.z - sign.z)).toBeGreaterThan(900);
    expect(layer.counts().drawCalls).toBe(1);
    const glow = layer.group.children.find((o) => o.name === 'landmarks-glow') as Mesh;
    expect(glow.visible).toBe(false);
  });
});

// Playtest 4, P1 (the wave C check: Pioneer Courthouse Square "reads as a low brick strip"): the square's
// model is a hand's breadth of paving under a 5 m column, and the land the road draws caps its scale, so
// the feature now says `cloudM` and the layer hangs a rain cloud over it with its rain falling beneath.
describe('a rain cloud over the courthouse square (playtest 4, P1)', () => {
  const colourKey = (hex: string): number[] => {
    const c = new Color(hex);
    return [c.r, c.g, c.b].map((v) => Math.round(v * 1e4));
  };

  /** The vertices of a colour in the lit mesh. */
  function verticesOf(layer: LandmarkLayer, hex: string): Vector3[] {
    const mesh = layer.group.children.find((o) => o.name === 'landmarks') as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const col = mesh.geometry.getAttribute('color');
    const want = colourKey(hex);
    const out: Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const got = [col.getX(i), col.getY(i), col.getZ(i)].map((v) => Math.round(v * 1e4));
      if (got.every((v, k) => Math.abs(v - (want[k] ?? 0)) <= 1))
        out.push(new Vector3().fromBufferAttribute(pos, i));
    }
    return out;
  }

  /** Bridge City with the courthouse square's `cloudM` taken off. */
  function withoutCloud(): RoadNetwork {
    const network = Object.values(networkFiles).find((n) => n.id === 'osm-pnw-portland') as BakedNetwork;
    return createRoadNetwork({
      network,
      roads: Object.values(roadFiles)
        .filter((r) => network.roads.includes(r.id))
        .map((r) => ({
          ...r,
          features: (r.features ?? []).map((f) =>
            f.kind === 'landmark' ? { ...f, params: { ...f.params, cloudM: undefined } } : f,
          ),
        })),
    });
  }

  it('hangs a grey cloud over the square at the height the road names, with rain falling from it to the ground', async () => {
    const road = track('osm-pnw-portland');
    const kits = await kitsFor(road);
    const plaza = landmarkPlacements(road).find((p) => p.node === 'pdx_plaza');
    expect(plaza?.feature.params?.['cloudM'], 'the road names a cloud height').toBeGreaterThan(5);
    if (!plaza) return;
    const cloudM = Number(plaza.feature.params?.['cloudM']);
    const layer = new LandmarkLayer(kits, look, { road });
    layer.update(plaza.x, plaza.z - 60);

    const cloud = verticesOf(layer, RAIN_CLOUD.cloud);
    const rain = verticesOf(layer, RAIN_CLOUD.rain);
    expect(cloud.length, 'cloud vertices').toBeGreaterThan(200);
    expect(rain.length, 'rain vertices').toBeGreaterThan(200);
    const lo = Math.min(...cloud.map((v) => v.y));
    const hi = Math.max(...cloud.map((v) => v.y));
    // The blobs hang about the base height: the lowest a blob's half-height under it, the top above it.
    expect(lo).toBeGreaterThan(plaza.y + cloudM - 3.6);
    expect(hi).toBeGreaterThan(plaza.y + cloudM + 2);
    // Over the square: its middle within a few metres of the feature's.
    const mid = cloud.reduce((a, v) => a.add(v), new Vector3()).divideScalar(cloud.length);
    expect(Math.hypot(mid.x - plaza.x, mid.z - plaza.z)).toBeLessThan(4);
    // The rain stands on the ground and reaches the cloud, and keeps off the road and its sidewalk.
    expect(Math.min(...rain.map((v) => v.y))).toBeLessThan(plaza.y + 1);
    expect(Math.max(...rain.map((v) => v.y))).toBeGreaterThan(plaza.y + cloudM);
    const e = road.edges[plaza.edge];
    let nearest = Infinity;
    for (const v of rain) nearest = Math.min(nearest, Math.abs(road.project(v.x, v.z, plaza.edge).d));
    expect(nearest, 'rain keeps past the road and its sidewalk').toBeGreaterThan((e?.dMax ?? 0) + 3.4 - 0.5);
    stdout.write(
      `[examined] courthouse square: a cloud ${(lo - plaza.y).toFixed(1)} to ${(hi - plaza.y).toFixed(1)} m over its ground (${cloudM} m asked), ${cloud.length / 3} cloud and ${rain.length / 3} rain triangles, the rain's nearest to the road ${nearest.toFixed(1)} m; ${layer.counts().drawCalls} draw call in view\n`,
    );
    // It costs no draw call: the cloud is in the lit mesh, so the view costs what it does without it.
    const without = new LandmarkLayer(kits, look, { road: withoutCloud() });
    without.update(plaza.x, plaza.z - 60);
    expect(layer.counts().drawCalls).toBe(without.counts().drawCalls);
  });

  it('draws no cloud where the road names none (the control)', async () => {
    const road = track('osm-pnw-portland');
    const kits = await kitsFor(road);
    const plaza = landmarkPlacements(road).find((p) => p.node === 'pdx_plaza');
    if (!plaza) throw new Error('no plaza');
    const bare = withoutCloud();
    const layer = new LandmarkLayer(kits, look, { road: bare });
    layer.update(plaza.x, plaza.z - 60);
    expect(verticesOf(layer, RAIN_CLOUD.cloud)).toHaveLength(0);
    expect(verticesOf(layer, RAIN_CLOUD.rain)).toHaveLength(0);
  });
});
