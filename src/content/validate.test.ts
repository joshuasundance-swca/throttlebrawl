// The build's pre-parse (lane F1, the first-load headroom): a production build runs the schemas on
// every pack file and ships Zod's output, and the page's loader only copies it (validate-prebuilt.ts).
// These tests hold that, for every pack on disk, the registry the page builds that way is the one
// the Zod loader builds, byte for byte and key for key, with the same content hashes, so no replay
// key moves; and that the comparison would see a file the build had not pre-parsed.
import { describe, expect, it } from 'vitest';
import { combineRegistries, groupPackFiles } from './packs';
import { parsePack, parsePackWith, type PackFile } from './parse';
import { packFileOf, preParsePackFile } from './pre-parse';
import { buildRegistry, buildRegistryWith, contentHashes } from './registry';
import * as prebuilt from './validate-prebuilt';

const ALL = import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' });
/**
 * Every pack as a build reads it today: each file written as JSON and read back. The one difference
 * from the files on disk is a `-0.0` (five real-road files' curvature), which a build's JSON
 * already reads as 0 (scripts/json-assets.mjs rewrites the road data it ships, run W-P).
 */
const PACKS = new Map(
  [...groupPackFiles(ALL)].map(([id, files]) => [
    id,
    files.map((f) => ({ path: f.path, json: JSON.parse(JSON.stringify(f.json)) as unknown })),
  ]),
);

/** What the build ships for each file: the pre-parse, written as JSON and read back. */
function shipped(files: readonly PackFile[]): PackFile[] {
  return files.map((f) => {
    const r = preParsePackFile(f.path, structuredClone(f.json));
    if ('findings' in r) throw new Error(`${f.path}: ${r.findings.map((x) => x.message).join('; ')}`);
    return { path: f.path, json: JSON.parse(JSON.stringify(r.data)) as unknown };
  });
}

describe('the pre-parsed packs', () => {
  it('give the Zod loader’s pack, registry and content hashes, for every pack on disk', () => {
    let files = 0;
    let changed = 0;
    const zodRegs = [];
    const preRegs = [];
    for (const [packId, raw] of PACKS) {
      const ship = shipped(raw);
      files += raw.length;
      changed += raw.filter((f, i) => JSON.stringify(f.json) !== JSON.stringify(ship[i]?.json)).length;
      const zod = parsePack(raw);
      const pre = parsePackWith(ship, prebuilt);
      expect(zod.findings, packId).toEqual([]);
      expect(pre.findings, packId).toEqual([]);
      expect(JSON.stringify(pre.pack), packId).toBe(JSON.stringify(zod.pack));
      expect(pre.pack, packId).toStrictEqual(zod.pack);
      for (const includeDrafts of [false, true]) {
        const z = buildRegistry(raw, { includeDrafts });
        const p = buildRegistryWith(ship, prebuilt, { includeDrafts });
        expect(JSON.stringify(p), packId).toBe(JSON.stringify(z));
        expect(p, packId).toStrictEqual(z);
        expect(contentHashes(p), packId).toEqual(contentHashes(z));
        if (!includeDrafts) {
          zodRegs.push(z);
          preRegs.push(p);
        }
      }
    }
    const zodAll = contentHashes(combineRegistries(zodRegs));
    expect(contentHashes(combineRegistries(preRegs))).toEqual(zodAll);
    console.log(
      `[examined] ${PACKS.size} packs, ${files} files; the pre-parse rewrote ${changed} of them ` +
        `(key order, defaults); combined hashes sim ${zodAll.sim} full ${zodAll.full} on both paths`,
    );
    expect(PACKS.size).toBeGreaterThanOrEqual(3);
  });

  it('negative control: the comparison sees a file the build did not pre-parse', () => {
    // A pack with a file the pre-parse rewrites (Zod's key order or a default): handed on unparsed,
    // the copy-only check keeps the file as it is, and the registry differs from the Zod loader's.
    const [packId, raw] = [...PACKS].find(([, files]) =>
      files.some((f, i) => JSON.stringify(f.json) !== JSON.stringify(shipped(files)[i]?.json)),
    ) ?? ['', []];
    expect(packId, 'a pack whose pre-parse changes a file').not.toBe('');
    const z = buildRegistry(raw);
    const unparsed = buildRegistryWith(raw, prebuilt);
    expect(JSON.stringify(unparsed)).not.toBe(JSON.stringify(z));
  });

  it('refuses a file the schemas refuse, and leaves a pack’s other files as they are', () => {
    const bad = preParsePackFile('bikes/broken.json', { type: 'bike', id: 'broken' });
    expect('findings' in bad && bad.findings.length > 0).toBe(true);
    const unknown = preParsePackFile('bikes/odd.json', { type: 'hovercraft', id: 'odd' });
    expect('findings' in unknown && unknown.findings[0]?.message).toBe('unknown entry type hovercraft');
    const asset = { anything: [1, 2] };
    expect(preParsePackFile('assets/backdrop/x/region.json', asset)).toEqual({ data: asset });
    expect(preParsePackFile('pack.index.json', asset)).toEqual({ data: asset });
  });

  it('copies what it is given, so freezing a registry never touches the bundled JSON', () => {
    const json = { type: 'bike', id: 'x', nested: { a: 1 } };
    const r = prebuilt.checkEntry('bikes/x.json', json);
    expect(r.ok && r.data.data).toEqual(json);
    expect(r.ok && r.data.data).not.toBe(json);
    expect(r.ok && (r.data.data['nested'] as object)).not.toBe(json.nested);
  });

  it('maps a repo path to its pack and pack-relative path', () => {
    expect(packFileOf('packs/base/regions/florida-keys/roads/a.json')).toEqual({
      packId: 'base',
      path: 'regions/florida-keys/roads/a.json',
    });
    expect(packFileOf('/packs/region-sf/pack.json')).toEqual({ packId: 'region-sf', path: 'pack.json' });
    expect(packFileOf('packs\\region-pnw\\bikes\\b.json')).toEqual({
      packId: 'region-pnw',
      path: 'bikes/b.json',
    });
    expect(packFileOf('src/content/packs.ts')).toBeNull();
  });
});
