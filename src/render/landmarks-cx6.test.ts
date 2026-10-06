// The CX6 landmark nodes (playtest 4, P4-19: "The real roads do not have the characteristics of the
// roads in question"), baked as the game bakes them: each kit is found through the asset manifest the
// build ships, and each new node resolves the way the landmark layer looks it up (`<node>`, else
// `<node>_lod0`, with `<node>_lod1` past a feature's `farM`; landmarks.ts `single()`). The cruise ship is placed on Duval's finish
// road (cruise-ship.test.ts), the flatiron on Kearny and the mission chapel on the Mission's last alley (sf-city-kit.test.ts);
// this proves only that the shipped kits answer for them, with no words of their own.
import { describe, expect, it } from 'vitest';
import { assetIndex, createPackLibrary } from '../content';
import { readGlb } from './glb';
import { bakeLandmarkKit, landmarkKitAsset, type LandmarkKit, type LandmarkKitId } from './models';

/** The name a later run's feature uses (`<kit>#<node>`), and whether it has a far stand-in. */
const NEW_NODES: Readonly<Record<string, readonly [node: string, lod: boolean][]>> = {
  'sf-landmarks': [
    ['sf_flatiron', true],
    ['sf_mission_church', false],
  ],
  'keys-landmarks': [['cruise_ship', true]],
};

async function kit(id: LandmarkKitId): Promise<LandmarkKit | null> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const row = assetIndex(createPackLibrary().registry()).find((r) => r.id === landmarkKitAsset(id));
  expect(row, `${id}: a row in the asset manifest the build ships`).toBeDefined();
  if (!row) return null;
  const buf = fs.readFileSync(`packs/${row.packId}/assets/${row.id}.glb`);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return bakeLandmarkKit(id, readGlb(data));
}

const tris = (n: { geometry: { getAttribute(k: string): { count: number } } }) =>
  n.geometry.getAttribute('position').count / 3;

describe('the CX6 landmark nodes, as the game bakes the shipped kits', () => {
  for (const [id, nodes] of Object.entries(NEW_NODES)) {
    it(`${id}: every new node resolves, near and far, with no boards`, async () => {
      const k = await kit(id as LandmarkKitId);
      if (!k) return;
      const lines: string[] = [];
      for (const [node, lod] of nodes) {
        const near = k.nodes.get(node) ?? k.nodes.get(`${node}_lod0`);
        expect(near, `${id}#${node}`).toBeDefined();
        if (!near) continue;
        expect(tris(near)).toBeGreaterThan(0);
        expect(near.surfaces, `${node}: no words of its own`).toHaveLength(0);
        const far = k.nodes.get(`${node}_lod1`);
        if (lod) {
          expect(far, `${node}_lod1`).toBeDefined();
          if (far) expect(tris(far)).toBeLessThanOrEqual(0.3 * tris(near));
        } else expect(far).toBeUndefined();
        lines.push(`${node} ${tris(near)}${far ? `/${tris(far)}` : ''}`);
      }
      console.log(`[examined] ${id}: ${k.nodes.size} nodes; new: ${lines.join(', ')}`);
    });
  }
});
