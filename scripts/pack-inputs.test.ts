import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { cachePath, sha256 } from './dataset-assets.mjs';
import { packInputs } from './pack-inputs.mjs';

const parent = path.resolve('scratch/pack-input-tests');
mkdirSync(parent, { recursive: true });
const root = mkdtempSync(path.join(parent, 'case-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const target = 'packs/test/regions/test/networks/example.json';
const source = JSON.stringify({ type: 'road-network', id: 'example', roads: ['a'] });
const terrain = { patches: [{ vertices: [[1.234567891, 2, 3]], triangles: [] }] };
function prepare(body = JSON.stringify(terrain)) {
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
  return cache;
}

it('embeds only the mapped network, preserving original numbers, source bytes and unrelated JSON', () => {
  prepare();
  mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  writeFileSync(path.join(root, target), source);
  const inputs = packInputs(root);
  const actual = inputs.materialize(target, source);
  expect(JSON.parse(actual) as unknown).toEqual({
    type: 'road-network',
    id: 'example',
    roads: ['a'],
    terrain,
  });
  expect(actual).toContain('1.234567891');
  expect(readFileSync(path.join(root, target), 'utf8')).toBe(source);
  expect(inputs.materialize('packs/test/pack.json', ' { "id": "test" } ')).toBe(' { "id": "test" } ');
});

it('requires a verified cache even after a successful earlier read, with an actionable offline error', () => {
  const cache = prepare();
  const inputs = packInputs(root);
  expect((JSON.parse(inputs.materialize(target, source)) as { terrain: unknown }).terrain).toEqual(terrain);
  writeFileSync(cache, 'corrupt');
  expect(() => inputs.materialize(target, source)).toThrow(/assets:fetch.*--build-inputs/);
  rmSync(cache);
  expect(() => inputs.materialize(target, source)).toThrow(/assets:fetch.*--build-inputs/);
});

it('rejects wrong target types, inline collisions and malformed payloads before normal schema validation', () => {
  prepare();
  const inputs = packInputs(root);
  expect(() => inputs.materialize(target, '{"type":"road"}')).toThrow(/road-network/);
  expect(() => inputs.materialize(target, '{"type":"road-network","terrain":{}}')).toThrow(/inline terrain/);
  for (const body of ['null', '[]', '{"other":1}', '{"patches":{}}', '{"patches":[],"executable":1}']) {
    prepare(body);
    expect(() => packInputs(root).materialize(target, source)).toThrow(/terrain input/);
  }
});

it('leaves fixtures without a dataset lock alone, and refuses an invalid present lock', () => {
  rmSync(path.join(root, 'assets.lock.json'));
  expect(packInputs(root).materialize(target, source)).toBe(source);
  writeFileSync(path.join(root, 'assets.lock.json'), '{}');
  expect(() => packInputs(root)).toThrow(/assets.lock.json/);
});
