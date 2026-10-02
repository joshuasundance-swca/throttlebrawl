import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { minifyJson, minifyJsonAssetsPlugin } from './json-assets.mjs';

// Run W-P: the build writes its JSON assets (the road data fetched on demand) on one line.

type Asset = { type: 'asset' | 'chunk'; fileName: string; source?: string | Uint8Array };
type Plugin = { generateBundle(o: unknown, bundle: Record<string, Asset>): void };

describe('minified JSON assets', () => {
  it('writes a real road file on one line with the same data, a fifth smaller or more', () => {
    const text = readFileSync('packs/base/regions/florida-keys/roads/osm-big-pine-bend.json', 'utf8');
    const min = minifyJson(text) as string;
    expect(JSON.parse(min)).toEqual(JSON.parse(text));
    expect(min).not.toContain('\n');
    expect(min.length).toBeLessThan(text.length * 0.8);
  });

  it('minifies emitted .json assets only, string or bytes, and leaves broken JSON alone', () => {
    const pretty = '{\n  "a": [1, 2],\n  "b": "x"\n}\n';
    const bundle: Record<string, Asset> = {
      road: { type: 'asset', fileName: 'assets/road-abc.json', source: pretty },
      bytes: { type: 'asset', fileName: 'assets/net-abc.json', source: new TextEncoder().encode(pretty) },
      broken: { type: 'asset', fileName: 'assets/bad.json', source: '{ nope' },
      model: { type: 'asset', fileName: 'assets/palms.glb', source: pretty },
      code: { type: 'chunk', fileName: 'assets/index.js' },
    };
    (minifyJsonAssetsPlugin() as Plugin).generateBundle({}, bundle);
    expect(bundle['road']?.source).toBe('{"a":[1,2],"b":"x"}');
    expect(bundle['bytes']?.source).toBe('{"a":[1,2],"b":"x"}');
    expect(bundle['broken']?.source).toBe('{ nope');
    expect(bundle['model']?.source).toBe(pretty);
  });
});
