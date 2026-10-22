import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import mara from '../../../packs/region-clinton/riders/mara-vale.json';
import { cachedBytes, readLock } from '../../../scripts/dataset-assets.mjs';
import { readGlb } from '../../../src/render/glb';
import { riderLookOf } from '../../../src/render/rider-looks';
import { bakePart } from '../../../src/render/riders/bake';
import { datasetPath, RIDERS } from './catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('Mara draws her own Iowa surveyor model', () => {
  it('the actual rider look resolves to her pinned, real authored body', () => {
    const source = {
      contentId: `region-clinton:${mara.id}`,
      role: 'rival' as const,
      bikeId: mara.bike,
      look: mara.look,
    };
    const look = riderLookOf(source);
    expect(look.riderModel).toBe(`models/riders/${mara.id}`);
    expect(look.bikeModel).toBe(`models/bikes/${mara.look.bikeModel}`);
    const row = RIDERS.find((candidate) => candidate.id === mara.id);
    if (!row) throw new Error('Mara needs her own rider catalog entry');
    const { lock, problems } = readLock(root);
    expect(problems).toEqual([]);
    if (!lock) throw new Error('Mara model lock did not load');
    const pin = lock.files.find((file) => file.path === datasetPath(row));
    if (!pin) throw new Error('Mara needs a pinned rider model');
    expect(pin.region).toBe(mara.region);
    const bytes = cachedBytes(root, pin);
    if (!bytes) throw new Error('Mara model cache must match the published pin');
    const body = bakePart(readGlb(Uint8Array.from(bytes).buffer), 'rider');
    expect(body.extras['rider_id']).toBe(mara.id);
    expect(body.triangles).toBeGreaterThan(0);
    expect(body.triangles).toBeLessThanOrEqual(row.maxTris);
    // Reusing Juniper is supported for other content, but does not satisfy Mara's own-body brief.
    const borrowed = riderLookOf({ ...source, look: { ...mara.look, riderModel: 'juniper-moss' } });
    expect(borrowed.riderModel).not.toBe(look.riderModel);
  });
});
