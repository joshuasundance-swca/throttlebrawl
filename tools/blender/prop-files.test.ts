import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cachePath, sha256 } from '../../scripts/dataset-assets.mjs';
import { datasetPath, glbPath, PROPS } from './catalog.mjs';
import { acceptBuild } from './build.mjs';
import { propFile, propInventoryProblems } from './prop-files.mjs';
import { repoRoot } from './score.mjs';

const tower = PROPS.find((p) => p.name === 'eagle_stone_tower')!;
const roots: string[] = [];
const noFetch = () => Promise.reject(new Error('unexpected fetch'));
function put(root: string, rel: string, bytes: string | Buffer) {
  const file = path.join(root, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  return file;
}
function fixture(bytes = Buffer.from('verified fixture')) {
  mkdirSync('scratch', { recursive: true });
  const root = mkdtempSync(path.resolve('scratch/prop-files-'));
  roots.push(root);
  put(root, 'packs/region-clinton/pack.json', '{}');
  mkdirSync(path.join(root, 'packs/region-clinton/regions/clinton-iowa'), { recursive: true });
  const pin = {
    path: 'region-clinton/models/landmarks/eagle-stone-tower.glb',
    bytes: bytes.length,
    sha256: sha256(bytes),
    region: 'clinton-iowa',
  };
  const lock = {
    formatVersion: 1,
    repo: 'example/assets',
    repoType: 'dataset',
    revision: 'a'.repeat(40),
    files: [pin],
  };
  const save = () => put(root, 'assets.lock.json', JSON.stringify(lock));
  save();
  const fetchFn = vi.fn(() => Promise.resolve(new Response(bytes)));
  return { root, bytes, pin, lock, save, fetchFn };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe('catalog prop files', () => {
  it('declares dataset storage only for the tower and retains legacy pack paths', () => {
    expect(tower.storage).toBe('dataset');
    expect(datasetPath(tower)).toBe('region-clinton/models/landmarks/eagle-stone-tower.glb');
    expect(glbPath(tower)).toBe('packs/region-clinton/assets/models/landmarks/eagle-stone-tower.glb');
    const legacy = PROPS.find((p) => p.name === 'boat')!;
    expect(legacy.storage ?? 'pack').toBe('pack');
    expect(glbPath(legacy)).toBe(`packs/base/assets/${legacy.asset}.glb`);
  });

  it('fetches a cold pin at its exact revision, then reads a verified warm cache without fetching', async () => {
    const f = fixture();
    const first = await propFile(f.root, tower, f.fetchFn);
    expect(first.bytes).toEqual(f.bytes);
    expect(first.file).toBe(cachePath(f.root, f.pin.path));
    expect(first.downloaded).toBe(true);
    expect(f.fetchFn).toHaveBeenCalledExactlyOnceWith(
      `https://huggingface.co/datasets/example/assets/resolve/${f.lock.revision}/${f.pin.path}`,
    );
    const warm = await propFile(f.root, tower, noFetch);
    expect(warm.bytes).toEqual(f.bytes);
    expect(warm.downloaded).toBe(false);
  });

  it('repairs a corrupt cache only with verified downloaded bytes', async () => {
    const f = fixture();
    put(f.root, `.cache/assets/${f.pin.path}`, Buffer.alloc(f.bytes.length, 0));
    expect((await propFile(f.root, tower, f.fetchFn)).bytes).toEqual(f.bytes);
    expect(readFileSync(cachePath(f.root, f.pin.path))).toEqual(f.bytes);
    put(f.root, `.cache/assets/${f.pin.path}`, 'corrupt again');
    await expect(propFile(f.root, tower, () => Promise.resolve(new Response('wrong')))).rejects.toThrow(
      /the lock pins/,
    );
    expect(readFileSync(cachePath(f.root, f.pin.path), 'utf8')).toBe('corrupt again');
    await expect(propFile(f.root, tower, noFetch)).rejects.toThrow(/could not download/);
  });

  it('rejects a missing pin without falling back to a local file', async () => {
    const f = fixture();
    f.lock.files = [];
    f.save();
    put(f.root, glbPath(tower), 'local fallback must not be consumed');
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/missing dataset pin/);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it.each(['sha256', 'bytes'] as const)('rejects a pin with malformed %s before fetching', async (key) => {
    const f = fixture();
    if (key === 'sha256') f.pin.sha256 = 'invalid';
    else f.pin.bytes = 0;
    f.save();
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(new RegExp(key));
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it.each(['sha256', 'bytes'] as const)('rejects valid-shaped but incorrect %s', async (key) => {
    const f = fixture();
    if (key === 'sha256') f.pin.sha256 = '0'.repeat(64);
    else f.pin.bytes++;
    f.save();
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/the lock pins/);
    expect(existsSync(cachePath(f.root, f.pin.path))).toBe(false);
  });

  it('rejects a pin with a missing, mismatched or foreign-pack region', async () => {
    const f = fixture();
    Reflect.deleteProperty(f.pin, 'region');
    f.save();
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/region/);
    for (const region of ['', 'other-region']) {
      f.pin.region = region;
      f.save();
      await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/region/);
    }
    f.pin.region = 'clinton-iowa';
    f.save();
    rmSync(path.join(f.root, 'packs/region-clinton/regions'), { recursive: true });
    mkdirSync(path.join(f.root, 'packs/other/regions/clinton-iowa'), { recursive: true });
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/region/);
    put(f.root, 'packs/region-clinton/regions/clinton-iowa', 'not a region directory');
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/region/);
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a duplicate pack asset id and duplicate catalog identity', async () => {
    const f = fixture();
    put(f.root, glbPath(tower), 'duplicate');
    await expect(propFile(f.root, tower, f.fetchFn)).rejects.toThrow(/already bakes/);
    expect(propInventoryProblems(f.root, [tower, tower])).toEqual(
      expect.arrayContaining([expect.stringMatching(/duplicate catalog/)]),
    );
    expect(f.fetchFn).not.toHaveBeenCalled();
  });

  it('reports orphan local and dataset props while keeping riders and placeholders in their own catalogs', () => {
    const f = fixture();
    expect(propInventoryProblems(f.root, [tower])).toEqual([]);
    const orphan = 'region-clinton/models/scenery/orphan.glb';
    put(f.root, 'packs/region-clinton/assets/models/scenery/orphan.glb', 'orphan');
    f.lock.files.push({ ...f.pin, path: orphan });
    f.lock.files.push({ ...f.pin, path: 'region-clinton/models/riders/separate.glb' });
    f.lock.files.push({ ...f.pin, path: 'region-clinton/models/placeholder/separate.glb' });
    f.save();
    const problems = propInventoryProblems(f.root, [tower]);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/orphan local GLB.*orphan/),
        expect.stringMatching(/orphan dataset prop.*orphan/),
      ]),
    );
    expect(problems.join('\n')).not.toMatch(/separate/);
    expect(propInventoryProblems(f.root, [{ ...tower, storage: 'pack' }])).toEqual(
      expect.arrayContaining([expect.stringMatching(/missing local GLB/)]),
    );
  });

  it('reads legacy bytes without a lock or network', async () => {
    const f = fixture();
    const legacy = { ...tower, storage: 'pack' as const };
    put(f.root, glbPath(legacy), f.bytes);
    rmSync(path.join(f.root, 'assets.lock.json'));
    expect((await propFile(f.root, legacy, noFetch)).bytes).toEqual(f.bytes);
  });
});

describe('dataset authoring candidates', () => {
  const actualBytes = async () => (await propFile(repoRoot, tower)).bytes;
  it('scores a deterministic candidate without changing the pin, published cache or legacy files', async () => {
    const f = fixture(await actualBytes());
    const cached = put(f.root, `.cache/assets/${f.pin.path}`, f.bytes);
    const legacy = put(f.root, 'packs/base/assets/models/scenery/untouched.glb', 'legacy');
    const lock = readFileSync(path.join(f.root, 'assets.lock.json'));
    const outs = ['a', 'b'].map((k) => put(f.root, `.cache/blender/build/tower.${k}.glb`, f.bytes));
    const result = await acceptBuild(f.root, tower, outs, { fetchFn: noFetch });
    expect(result.same).toBe(true);
    expect(result.score.summary.failed).toEqual([]);
    expect(result.note).toMatch(/candidate/);
    expect(existsSync(path.join(f.root, glbPath(tower)))).toBe(false);
    expect(readFileSync(cached)).toEqual(f.bytes);
    expect(readFileSync(path.join(f.root, 'assets.lock.json'))).toEqual(lock);
    expect(readFileSync(legacy, 'utf8')).toBe('legacy');
  });

  it('checks both rebuilds against cold verified published bytes and rejects differing candidates', async () => {
    const f = fixture(await actualBytes());
    const lock = readFileSync(path.join(f.root, 'assets.lock.json'));
    const outs = ['a', 'b'].map((k) => put(f.root, `.cache/blender/build/tower.${k}.glb`, f.bytes));
    const checked = await acceptBuild(f.root, tower, outs, { check: true, fetchFn: f.fetchFn });
    expect(checked.matches).toBe(true);
    expect(f.fetchFn).toHaveBeenCalledTimes(1);
    // Repacking keeps a valid GLB and score but changes its bytes.
    const changed = Buffer.from(f.bytes);
    const generator = changed.indexOf(Buffer.from('Blender'));
    expect(generator).toBeGreaterThan(0);
    changed[generator] = 'b'.charCodeAt(0);
    writeFileSync(outs[1]!, changed);
    const differs = await acceptBuild(f.root, tower, outs, { check: true, fetchFn: noFetch });
    expect(differs.same).toBe(false);
    expect(differs.matches).toBe(false);
    expect(readFileSync(cachePath(f.root, f.pin.path))).toEqual(f.bytes);
    expect(readFileSync(path.join(f.root, 'assets.lock.json'))).toEqual(lock);
    expect(existsSync(path.join(f.root, glbPath(tower)))).toBe(false);
  });

  it('preserves legacy build writes and read-only checks', async () => {
    const f = fixture(await actualBytes());
    const legacy = { ...tower, storage: 'pack' as const };
    const outs = ['a', 'b'].map((k) => put(f.root, `.cache/blender/build/tower.${k}.glb`, f.bytes));
    await acceptBuild(f.root, legacy, outs);
    const written = readFileSync(path.join(f.root, glbPath(legacy)));
    expect(written).toEqual(f.bytes);
    expect((await acceptBuild(f.root, legacy, outs, { check: true })).matches).toBe(true);
    expect(readFileSync(path.join(f.root, glbPath(legacy)))).toEqual(written);
  });
});
