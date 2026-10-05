// San Francisco's landmark kits on their real roads (playtest 3, CX3): the committed Golden Gate and
// sf-landmarks GLBs, baked as the game bakes them, placed by the baked networks' own `landmark`
// features. landmarks.test.ts checks the layer's rules with fixture kits; this checks that the real
// kits meet those rules on the real data: every feature finds its kit and node through the asset
// manifest, the layer draws them in one call, and the deck the road bakes passes between each tower's
// legs at its real height there.
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
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
