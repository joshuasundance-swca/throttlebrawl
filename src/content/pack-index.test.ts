import { describe, expect, it } from 'vitest';
import { buildPackIndex, type PackIndexInput } from './index';

const enc = (text: string) => new TextEncoder().encode(text);
// A stand-in digest so the test does not depend on a crypto library; the tool passes SHA-256.
const fakeSha = (bytes: Uint8Array) => `len${bytes.length}`;

const manifest = {
  type: 'pack',
  id: 'base',
  name: 'Base',
  version: '0.1.0',
  formatVersion: 1,
  license: 'MIT',
  defaults: { tuning: 'registry', hud: 'classic' },
  assetSources: {
    default: 'baked',
    rules: [
      { match: 'audio/barks/**', source: 'remote', store: 'hf-dataset', baseUrl: 'https://example.invalid/' },
    ],
  },
};

function input(files: Record<string, string>): PackIndexInput[] {
  return Object.entries(files).map(([path, text]) => ({ path, bytes: enc(text) }));
}

describe('content: the pack indexer', () => {
  it('lists every file with its type, id, size and hash, in path order', () => {
    const bike = JSON.stringify({ type: 'bike', id: 'putt-50' });
    const { index, findings } = buildPackIndex(
      input({ 'pack.json': JSON.stringify(manifest), 'bikes/putt-50.json': bike }),
      fakeSha,
    );
    expect(findings).toEqual([]);
    expect(index.packId).toBe('base');
    expect(index.formatVersion).toBe(1);
    expect(index.files).toEqual([
      {
        path: 'bikes/putt-50.json',
        type: 'bike',
        id: 'putt-50',
        bytes: bike.length,
        hash: `len${bike.length}`,
      },
      expect.objectContaining({ path: 'pack.json', type: 'pack', id: 'base' }),
    ]);
    expect(index.assets).toEqual([]);
  });

  it('turns files under assets/ into manifest rows with a kind and a source', () => {
    const { index, findings } = buildPackIndex(
      input({
        'pack.json': JSON.stringify(manifest),
        'assets/models/bikes/putt-scooter.glb': 'glb!',
        'assets/audio/barks/kevin/per-my-last-email.ogg': 'ogg',
        'assets/stills/interludes/intro.webp': 'webp',
      }),
      fakeSha,
    );
    expect(findings).toEqual([]);
    expect(index.assets).toEqual([
      {
        id: 'audio/barks/kevin/per-my-last-email',
        kind: 'audio',
        source: 'remote',
        path: 'assets/audio/barks/kevin/per-my-last-email.ogg',
        bytes: 3,
        hash: 'len3',
        packId: 'base',
      },
      expect.objectContaining({ id: 'models/bikes/putt-scooter', kind: 'mesh', source: 'baked' }),
      expect.objectContaining({ id: 'stills/interludes/intro', kind: 'image', source: 'baked' }),
    ]);
  });

  it('flags an asset format outside the allowlist', () => {
    const { findings } = buildPackIndex(
      input({ 'pack.json': JSON.stringify(manifest), 'assets/models/evil.exe': 'MZ' }),
      fakeSha,
    );
    expect(findings).toEqual([
      expect.objectContaining({ level: 'error', file: 'assets/models/evil.exe', rule: 'assets' }),
    ]);
  });
});
