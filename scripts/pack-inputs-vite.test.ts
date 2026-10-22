import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { build, createServer, type Rolldown } from 'vite';
import { afterAll, expect, it } from 'vitest';
import { cachePath, datasetAssetsPlugin, sha256 } from './dataset-assets.mjs';
import { packInputsPlugin } from './pack-inputs-vite.mjs';
import { preParsePacksPlugin } from './pre-parse-packs.mjs';

const parent = path.resolve('scratch/pack-input-vite-tests');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(path.join(parent, 'case-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const target = 'packs/test/regions/test/networks/example.json';
const terrain = {
  patches: [
    {
      surface: 'grass',
      vertices: [
        [1.234567891, 2, 3],
        [0, 2, 10],
        [10, 2, 0],
      ],
      triangles: [[0, 1, 2]],
    },
  ],
};
function prepare(value = terrain) {
  const body = JSON.stringify(value);
  const file = {
    path: 'test/terrain/example.json',
    bytes: Buffer.byteLength(body),
    sha256: sha256(Buffer.from(body)),
    embed: { kind: 'network-terrain', target },
  };
  writeFileSync(
    path.join(root, 'assets.lock.json'),
    JSON.stringify({
      formatVersion: 1,
      repo: 'example/assets',
      repoType: 'dataset',
      revision: 'a'.repeat(40),
      files: [file],
    }),
  );
  const cache = cachePath(root, file.path);
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, body);
  mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  writeFileSync(path.join(root, target), '{"type":"road-network","id":"example"}');
  writeFileSync(
    path.join(root, 'entry.js'),
    `import data from './${target}';
    import url from './${target}?url';
    const glob = import.meta.glob('./packs/**/*.json', { eager: true, import: 'default' });
    console.log(data, url, glob);`,
  );
}
async function compiled(enabled = true, validate = false, fetchFn?: typeof fetch) {
  return (await build({
    configFile: false,
    root,
    logLevel: 'silent',
    base: './',
    plugins: [
      ...(enabled ? [packInputsPlugin({ root })] : []),
      ...(validate ? [preParsePacksPlugin({ root })] : []),
      ...(fetchFn ? [datasetAssetsPlugin({ root, fetchFn })] : []),
    ],
    build: {
      write: false,
      minify: false,
      assetsInlineLimit: 0,
      rolldownOptions: { input: path.join(root, 'entry.js') },
    },
  })) as Rolldown.RolldownOutput;
}

it('assembles normal JSON, eager glob and emitted ?url through the actual Vite pipeline', async () => {
  prepare();
  const control = await compiled(false);
  const controlAsset = control.output.find(
    (file) => file.type === 'asset' && file.fileName.endsWith('.json'),
  );
  expect(
    controlAsset?.type === 'asset' &&
      (JSON.parse(String(controlAsset.source)) as { terrain?: unknown }).terrain,
  ).toBeUndefined();
  const result = await compiled();
  const assets = result.output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.json'));
  expect(assets).toHaveLength(1);
  const asset = assets[0];
  if (!asset || asset.type !== 'asset') throw new Error('missing network');
  expect(JSON.parse(String(asset.source))).toEqual({ type: 'road-network', id: 'example', terrain });
  expect(asset.originalFileNames.map((file) => file.replaceAll('\\', '/'))).toContain(
    path.join(root, target).replaceAll('\\', '/'),
  );
  const code = result.output
    .filter((file) => file.type === 'chunk')
    .map((file) => file.code)
    .join('\n');
  expect(code).toContain('1.234567891');
  expect(code).toContain(path.basename(asset.fileName));
  expect(code).not.toContain('ROLLUP_FILE_URL_');
  prepare({ patches: [{ ...terrain.patches[0]!, vertices: [[9.234567891, 2, 3]] }] });
  const changed = await compiled();
  expect(changed.output.filter((file) => file.type === 'asset').map((file) => file.fileName)).not.toContain(
    asset.fileName,
  );
});

it('waits for existing dataset build preparation before consuming a cold terrain input', async () => {
  prepare();
  rmSync(cachePath(root, 'test/terrain/example.json'));
  await expect(compiled()).rejects.toThrow(/assets:fetch.*--build-inputs/);
  const requests: string[] = [];
  const fetchFn: typeof fetch = (input) => {
    requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return Promise.resolve(new Response(JSON.stringify(terrain)));
  };
  const result = await compiled(true, false, fetchFn);
  expect(requests).toEqual([
    `https://huggingface.co/datasets/example/assets/resolve/${'a'.repeat(40)}/test/terrain/example.json`,
  ]);
  const assets = result.output.filter((file) => file.type === 'asset' && file.fileName.endsWith('.json'));
  expect(assets).toHaveLength(1);
  expect(assets[0]?.type === 'asset' && String(assets[0].source)).toContain('1.234567891');
  await compiled(true, false, () => Promise.reject(new Error('offline')));
});

it('keeps full production schema validation for both imported and emitted networks', async () => {
  prepare();
  const bridge = path.join(root, 'src/content/pre-parse.ts');
  mkdirSync(path.dirname(bridge), { recursive: true });
  writeFileSync(
    bridge,
    `export { packFileOf, preParsePackFile } from ${JSON.stringify(path.resolve('src/content/pre-parse.ts').replaceAll('\\', '/'))};`,
  );
  const validNetwork = {
    type: 'road-network',
    id: 'example',
    roads: ['road'],
    junctions: [],
    region: 'test',
    crs: { kind: 'tmerc', originLatDeg: 0, originLonDeg: 0 },
  };
  writeFileSync(path.join(root, target), JSON.stringify(validNetwork));
  const good = await compiled(true, true);
  expect(
    good.output.some((file) => file.type === 'asset' && String(file.source).includes('1.234567891')),
  ).toBe(true);
  // A hash-valid payload still has to obey the terrain schema; exercise both consumer paths.
  prepare({ patches: [{ ...terrain.patches[0]!, triangles: [[0, 1, 99]] }] });
  writeFileSync(path.join(root, target), JSON.stringify(validNetwork));
  for (const query of ['', '?url']) {
    writeFileSync(path.join(root, 'entry.js'), `import data from './${target}${query}'; console.log(data);`);
    await expect(compiled(true, true)).rejects.toThrow(/schema check|triangle|vertex/i);
  }
});

it('serves the same terrain in dev JSON modules and the URL fetched by the runtime loader', async () => {
  prepare();
  const server = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [packInputsPlugin({ root })],
    server: { host: '127.0.0.1', port: 0 },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('missing dev server');
    const origin = `http://127.0.0.1:${address.port}`;
    const module = await server.transformRequest(`/${target}?url`);
    expect(module?.code).toContain(`/${target}?pack-input`);
    const json: unknown = await fetch(`${origin}/${target}?pack-input`).then((response) => response.json());
    expect(json).toEqual({ type: 'road-network', id: 'example', terrain });
    // Real HTTP module requests must reach Vite's JSON transform rather than returning raw JSON.
    const entry = await fetch(`${origin}/entry.js`).then((response) => response.text());
    const importUrl = /import data from ["']([^"']+)["']/.exec(entry)?.[1];
    expect(importUrl).toBeDefined();
    const moduleResponse = await fetch(`${origin}${importUrl}`).then((response) => response.text());
    expect(moduleResponse).toContain('export default');
    expect(moduleResponse).toContain('1.234567891');
    const normal = await server.transformRequest(`/${target}`);
    expect(normal?.code).toContain('1.234567891');
  } finally {
    await server.close();
  }
});
