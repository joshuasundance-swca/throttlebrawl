// The bark clips the packs carry (tools/voices makes them): every clip belongs to a live line
// whose `audioAsset` names it by the rule bark-voices.ts plays by, every voiced line has its file,
// a vetoed voice has none, and the clips stay small. The game looks clips up by the rule, so this
// is what keeps a pack's `audioAsset` fields and its files telling the same story.
import { describe, expect, it } from 'vitest';
import { barkClipPath } from './bark-voices';

interface Line {
  id: string;
  text: string;
  status?: string;
  audioAsset?: string | null;
  audioStatus?: string;
}
interface BarkSetFile {
  id: string;
  lines: Line[];
}

const SETS = import.meta.glob<BarkSetFile>('/packs/*/barks/*.json', { eager: true, import: 'default' });
const CLIPS = import.meta.glob<string>('/packs/*/assets/audio/barks/**/*.ogg', {
  eager: true,
  query: '?inline',
  import: 'default',
});
const KEYS = Object.keys(CLIPS);

/** A clip's size in bytes, from its inlined base64 data URL. */
const bytesOf = (dataUrl: string) => {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
};

const lines = Object.entries(SETS).flatMap(([path, set]) => {
  const pack = /^\/packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  return set.lines.map((line) => ({ pack, set: set.id, line, ref: `${pack}:bark-set/${set.id}#${line.id}` }));
});

describe('bark clips in the packs', () => {
  it('belong to live lines that name them by the rule', () => {
    const byKey = new Map(
      lines.map((l) => [`/packs/${l.pack}/assets/audio/barks/${l.set}/${l.line.id}.ogg`, l]),
    );
    for (const key of KEYS) {
      const l = byKey.get(key);
      expect(l, `${key} has no bark line`).toBeDefined();
      if (!l) continue;
      expect(l.line.audioAsset, key).toBe(`audio/barks/${l.set}/${l.line.id}`);
      expect(l.line.audioStatus, key).not.toBe('vetoed');
      expect(l.line.status ?? 'live', key).not.toBe('vetoed');
      const at = barkClipPath(l.ref);
      expect(`/packs/${at?.packId}/${at?.path}`).toBe(key);
    }
  });

  it('exist for every voiced line, and never for a vetoed voice', () => {
    const have = new Set(KEYS);
    for (const l of lines) {
      const key = `/packs/${l.pack}/assets/audio/barks/${l.set}/${l.line.id}.ogg`;
      if (l.line.audioStatus === 'vetoed') expect(have.has(key), `${l.ref} is vetoed`).toBe(false);
      else if (l.line.audioAsset) expect(have.has(key), `${l.ref} has no clip`).toBe(true);
      if (l.line.audioStatus !== undefined) {
        expect(['live', 'vetoed', 'draft'], l.ref).toContain(l.line.audioStatus);
      }
    }
  });

  it('stay small: under 40 KB each and 4 MB in all', () => {
    let total = 0;
    for (const key of KEYS) {
      const n = bytesOf(CLIPS[key] ?? '');
      total += n;
      expect(n, key).toBeGreaterThan(500);
      expect(n, key).toBeLessThan(40 * 1024);
    }
    expect(total).toBeLessThan(4 * 1024 * 1024);
  });
});
