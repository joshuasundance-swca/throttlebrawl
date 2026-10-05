// Portland's landmark kit on its real road (playtest 3, CX4): the committed pdx-landmarks GLB, baked
// as the game bakes it, placed by Bridge City's own `landmark` features (the Hawthorne lift towers,
// T9.4). landmarks.test.ts checks the layer's rules with fixture kits; this checks that the real kit
// meets them on the real data: every feature finds its kit and node through the asset manifest, the
// layer draws them in one call, and the deck the road bakes passes between each tower's legs.
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements } from './landmarks';
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
    expect(layer.counts().drawCalls).toBe(1);
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
