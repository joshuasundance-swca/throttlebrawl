import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cachePath,
  datasetAssetsPlugin,
  distFileName,
  ensureCached,
  gitBlobSha1,
  LOCK_FILE,
  lockProblems,
  manifestRow,
  modelsByRegion,
  readLock,
  remoteFiles,
  repoProblems,
  resolveUrl,
  sha256,
  uploadPlan,
  worstRaceModelBytes,
} from './dataset-assets.mjs';
import { repoRoot } from './lib.mjs';

// Run W-Q (interview 2026-10-02: "Real models now"; round 7: offline keeps working): big files are
// pinned by assets.lock.json, fetched and sha256-checked into .cache/assets/, and baked into the
// build under assets/ds/<region>/.

const REV = 'a'.repeat(40);
const bytesOf = (s: string) => Buffer.from(s, 'utf8');
const fileFor = (p: string, body: Buffer, region?: string) => ({
  path: p,
  bytes: body.length,
  sha256: sha256(body),
  ...(region ? { region } : {}),
});
const lockWith = (files: unknown[]) => ({
  formatVersion: 1,
  repo: 'someone/throttlebrawl-assets',
  repoType: 'dataset',
  revision: REV,
  files,
});

// A scratch root under the git-ignored cache, with its own lock.
const root = path.join(repoRoot, '.cache', `dataset-test-${process.pid}`);
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A fetch that serves `bodies` by URL and counts its calls. */
function fakeFetch(bodies: Record<string, Buffer>) {
  const calls: string[] = [];
  const fn = (url: string) => {
    calls.push(url);
    const body = bodies[url];
    return Promise.resolve(
      body ? new Response(new Uint8Array(body), { status: 200 }) : new Response('not found', { status: 404 }),
    );
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('the committed lock', () => {
  it('is valid, pins an exact commit, and every file has a real pack, region and id of its own', () => {
    const { lock, problems } = readLock(repoRoot);
    expect(problems).toEqual([]);
    if (!lock) throw new Error(`${LOCK_FILE} did not load`);
    expect(lock.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.files.length).toBeGreaterThan(0);
    expect(repoProblems(repoRoot, lock)).toEqual([]);
    console.log(`[examined] ${LOCK_FILE}: ${lock.files.length} pinned files at ${lock.revision.slice(0, 7)}`);
  });
});

describe('lockProblems', () => {
  it('names every way a lock can be wrong', () => {
    const good = fileFor('base/models/riders/kevin.glb', bytesOf('x'));
    expect(lockProblems(lockWith([good]))).toEqual([]);
    expect(lockProblems({ ...lockWith([good]), revision: 'main' }).join()).toMatch(
      /exact 40-character commit/,
    );
    expect(lockProblems({ ...lockWith([good]), repoType: 'model' }).join()).toMatch(/repoType/);
    expect(lockProblems(lockWith([{ ...good, path: 'base/../evil.glb' }])).join()).toMatch(/path/);
    expect(lockProblems(lockWith([{ ...good, path: '/base/x.glb' }])).join()).toMatch(/path/);
    expect(lockProblems(lockWith([{ ...good, path: 'base/tools/run.exe' }])).join()).toMatch(
      /not an allowed/,
    );
    expect(lockProblems(lockWith([good, good])).join()).toMatch(/listed twice/);
    expect(lockProblems(lockWith([{ ...good, sha256: 'ABC' }])).join()).toMatch(/sha256/);
    expect(lockProblems(lockWith([{ ...good, region: 'Florida Keys' }])).join()).toMatch(/region/);
    expect(lockProblems(lockWith([{ ...good, url: 'https://x' }])).join()).toMatch(/unknown fields: url/);
  });
});

describe('repoProblems', () => {
  it('flags a missing pack, an unknown region, and an id its pack already bakes', () => {
    const one = bytesOf('x');
    const lock = lockWith([
      fileFor('nopack/models/a.glb', one),
      fileFor('base/models/riders/a.glb', one, 'atlantis'),
      fileFor('base/models/props/boat.glb', one),
      fileFor('region-sf/models/riders/gus.glb', one, 'san-francisco'),
    ]);
    const problems = repoProblems(repoRoot, lock).join('\n');
    expect(problems).toMatch(/no pack "nopack"/);
    expect(problems).toMatch(/region "atlantis" is not a region/);
    expect(problems).toMatch(/already bakes this asset id/);
    expect(problems).not.toMatch(/gus/);
  });
});

describe('names and rows', () => {
  it('builds the download URL, the dist name by region, and the manifest row by asset id', () => {
    const f = fileFor('region-pnw/models/riders/old-growth.glb', bytesOf('model'), 'pacific-northwest');
    const lock = lockWith([f]);
    expect(resolveUrl(lock, f.path)).toBe(
      `https://huggingface.co/datasets/someone/throttlebrawl-assets/resolve/${REV}/region-pnw/models/riders/old-growth.glb`,
    );
    expect(distFileName(f)).toBe(`assets/ds/pacific-northwest/old-growth-${f.sha256.slice(0, 8)}.glb`);
    expect(manifestRow(f, 'u')).toEqual({
      id: 'models/riders/old-growth',
      kind: 'mesh',
      source: 'dataset',
      path: 'u',
      bytes: f.bytes,
      hash: f.sha256,
      packId: 'region-pnw',
      region: 'pacific-northwest',
    });
    const shared = fileFor('base/models/placeholder/cube.glb', bytesOf('c'));
    expect(distFileName(shared)).toMatch(/^assets\/ds\/shared\/cube-[0-9a-f]{8}\.glb$/);
    expect(manifestRow(shared, 'u')).not.toHaveProperty('region');
  });
});

describe('ensureCached', () => {
  it('downloads once, checks the hash, and reuses the cache after that (offline)', async () => {
    const body = bytesOf('a real model');
    const f = fileFor('base/models/test/a.glb', body);
    const lock = lockWith([f]);
    const net = fakeFetch({ [resolveUrl(lock, f.path)]: body });
    const first = await ensureCached(root, lock, f, net.fn);
    expect(first.downloaded).toBe(true);
    expect(readFileSync(cachePath(root, f.path)).equals(body)).toBe(true);
    const offline = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const again = await ensureCached(root, lock, f, offline);
    expect(again.downloaded).toBe(false);
    expect(net.calls).toHaveLength(1);
  });

  it('refuses a file whose bytes differ from the pin, and says when the network is down', async () => {
    const f = fileFor('base/models/test/b.glb', bytesOf('the pinned bytes'));
    const lock = lockWith([f]);
    const net = fakeFetch({ [resolveUrl(lock, f.path)]: bytesOf('someone changed it') });
    await expect(ensureCached(root, lock, f, net.fn)).rejects.toThrow(/the lock pins/);
    expect(existsSync(cachePath(root, f.path))).toBe(false);
    const offline = (() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    await expect(ensureCached(root, lock, f, offline)).rejects.toThrow(/offline\?/);
    await expect(ensureCached(root, lock, f, fakeFetch({}).fn)).rejects.toThrow(/HTTP 404/);
  });

  it('downloads again when the cached copy was changed', async () => {
    const body = bytesOf('good');
    const f = fileFor('base/models/test/c.glb', body);
    const lock = lockWith([f]);
    mkdirSync(path.dirname(cachePath(root, f.path)), { recursive: true });
    writeFileSync(cachePath(root, f.path), 'tampered');
    const net = fakeFetch({ [resolveUrl(lock, f.path)]: body });
    expect((await ensureCached(root, lock, f, net.fn)).downloaded).toBe(true);
  });
});

describe('upload compares content, not paths', () => {
  // The Hub's paths-info shape, as the live dataset answered on 2026-10-02: a plain-git file has
  // `oid` (its git blob id, which `git hash-object` gave for marker-cube.glb) and no `lfs`; an LFS
  // file adds `lfs.oid`, its sha256. A path the revision lacks is left out of the answer.
  const plain = (p: string, body: Buffer) => ({
    type: 'file',
    path: p,
    size: body.length,
    oid: gitBlobSha1(body),
  });
  const lfs = (p: string, body: Buffer) => ({
    ...plain(p, body),
    oid: 'f'.repeat(40),
    lfs: { oid: sha256(body), size: body.length },
  });

  it('computes the git blob id the Hub reports', () => {
    expect(gitBlobSha1(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(gitBlobSha1(bytesOf('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('uploads a changed file at a path the dataset already has, and a new one, and skips the same', () => {
    const v1 = bytesOf('rider v1');
    const v2 = bytesOf('rider v2'); // same length as v1: only the content says it changed
    const kept = bytesOf('kept model');
    const big = bytesOf('an lfs model');
    const changed = fileFor('base/models/riders/a.glb', v2);
    const fresh = fileFor('base/models/riders/new.glb', bytesOf('brand new'));
    const same = fileFor('base/models/riders/b.glb', kept);
    const sameLfs = fileFor('base/models/riders/c.glb', big);
    const lock = lockWith([changed, fresh, same, sameLfs]);
    const remote = new Map<string, unknown>([
      [changed.path, plain(changed.path, v1)],
      [same.path, plain(same.path, kept)],
      [sameLfs.path, lfs(sameLfs.path, big)],
    ]);
    const cache = new Map([
      [changed.path, v2],
      [fresh.path, bytesOf('brand new')],
      [same.path, kept],
      [sameLfs.path, big],
    ]);
    const plan = uploadPlan(lock, remote, (f: { path: string }) => cache.get(f.path) ?? null);
    expect(plan.problems).toEqual([]);
    expect(plan.upload.map((u: { file: { path: string }; why: string }) => [u.file.path, u.why])).toEqual([
      [changed.path, 'changed'],
      [fresh.path, 'new'],
    ]);
    expect(plan.same).toBe(2);
  });

  it('judges an LFS file by its sha256 without the bytes, and names what it cannot upload', () => {
    const big = bytesOf('lfs pinned');
    const pinned = fileFor('base/models/riders/c.glb', big);
    const lock = lockWith([pinned]);
    const none = () => null;
    expect(uploadPlan(lock, new Map([[pinned.path, lfs(pinned.path, big)]]), none).same).toBe(1);
    const other = uploadPlan(lock, new Map([[pinned.path, lfs(pinned.path, bytesOf('lfs older'))]]), none);
    expect(other.problems.join()).toMatch(/holds other bytes and it is not cached/);
    const plainUncached = uploadPlan(lock, new Map([[pinned.path, plain(pinned.path, big)]]), none);
    expect(plainUncached.problems.join()).toMatch(/not cached, so it cannot be compared/);
    expect(uploadPlan(lock, new Map(), none).problems.join()).toMatch(/lacks it/);
  });

  it('asks the Hub for paths-info at one revision, in batches of 50, and keeps only files', async () => {
    const files = Array.from({ length: 51 }, (_, i) =>
      fileFor(`base/models/props/p${i}.glb`, bytesOf(`p${i}`)),
    );
    const lock = lockWith(files);
    const bodies: string[] = [];
    const fn = (url: string, init: { method: string; body: string }) => {
      expect(url).toBe(`https://huggingface.co/api/datasets/someone/throttlebrawl-assets/paths-info/${REV}`);
      expect(init.method).toBe('POST');
      bodies.push(init.body);
      const { paths } = JSON.parse(init.body) as { paths: string[] };
      const answer = paths.filter((p) => p !== 'base/models/props/p3.glb').map((p) => plain(p, bytesOf(p)));
      return Promise.resolve(new Response(JSON.stringify([...answer, { type: 'directory', path: 'base' }])));
    };
    const remote = await remoteFiles(
      lock,
      REV,
      files.map((f) => f.path),
      fn as unknown as typeof fetch,
    );
    expect(bodies).toHaveLength(2);
    expect(remote.size).toBe(50);
    expect(remote.has('base/models/props/p3.glb')).toBe(false);
    const down = (() => Promise.resolve(new Response('no', { status: 500 }))) as unknown as typeof fetch;
    await expect(remoteFiles(lock, REV, ['base/x.glb'], down)).rejects.toThrow(/HTTP 500/);
  });
});

describe('models per region', () => {
  it('counts dataset models by region and the rest as shared; a race needs shared plus one region', () => {
    const by = modelsByRegion([
      { rel: 'assets/palms-1.glb', bytes: 100 },
      { rel: 'assets/ds/shared/cube-1.glb', bytes: 10 },
      { rel: 'assets/ds/florida-keys/deacon-1.glb', bytes: 300 },
      { rel: 'assets/ds/florida-keys/chopper-1.glb', bytes: 200 },
      { rel: 'assets/ds/san-francisco/gus-1.glb', bytes: 400 },
      { rel: 'assets/road-1.json', bytes: 9999 },
    ]);
    expect(Object.fromEntries(by)).toEqual({
      shared: { files: 2, bytes: 110 },
      'florida-keys': { files: 2, bytes: 500 },
      'san-francisco': { files: 1, bytes: 400 },
    });
    expect(worstRaceModelBytes(by)).toBe(610);
  });
});

describe('the build plugin', () => {
  type Ctx = { emitFile(f: { fileName: string; source: Buffer }): void; error(m: string): never };
  type Hooks = {
    configResolved(c: { command: string; root: string }): void;
    resolveId(s: string): string | null;
    load(this: Ctx, id: string): Promise<string | null>;
  };
  const body = bytesOf('rider bytes');
  const f = fileFor('base/models/test/rider.glb', body, 'florida-keys');
  writeFileSync(
    path.join((mkdirSync(root, { recursive: true }), root), LOCK_FILE),
    JSON.stringify(lockWith([f])),
  );

  async function run(command: 'build' | 'serve', fetchFn: typeof fetch) {
    const plugin = datasetAssetsPlugin({ root, fetchFn }) as unknown as Hooks;
    plugin.configResolved({ command, root });
    const emitted: { fileName: string; source: Buffer }[] = [];
    const ctx: Ctx = {
      emitFile: (e) => void emitted.push(e),
      error: (m) => {
        throw new Error(m);
      },
    };
    const id = plugin.resolveId('virtual:dataset-assets');
    expect(id).toBeTruthy();
    const code = (await plugin.load.call(ctx, id as string)) ?? '';
    const rows = JSON.parse(code.replace(/^export default /, '').replace(/;$/, '')) as { path: string }[];
    return { emitted, rows };
  }

  it('in a build, fetches what is missing, emits it under assets/ds/<region>/ and names that path', async () => {
    rmSync(path.join(root, '.cache'), { recursive: true, force: true });
    const net = fakeFetch({ [resolveUrl(lockWith([f]), f.path)]: body });
    const { emitted, rows } = await run('build', net.fn);
    expect(emitted.map((e) => e.fileName)).toEqual([distFileName(f)]);
    expect(emitted[0]?.source.equals(body)).toBe(true);
    expect(rows.map((r) => r.path)).toEqual([distFileName(f)]);
    expect(net.calls).toHaveLength(1);
  });

  it('fails the build when a pinned file cannot be had, and never fetches in dev', async () => {
    rmSync(path.join(root, '.cache'), { recursive: true, force: true });
    await expect(run('build', fakeFetch({}).fn)).rejects.toThrow(/npm run assets:fetch/);
    const net = fakeFetch({});
    const dev = await run('serve', net.fn);
    expect(dev.emitted).toEqual([]);
    expect(dev.rows.map((r) => r.path)).toEqual([`.cache/assets/${f.path}`]);
    expect(net.calls).toEqual([]);
  });
});
