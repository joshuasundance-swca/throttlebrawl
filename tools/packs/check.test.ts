// packs:check end to end: the real packs pass and a count of examined files is printed; a broken
// fixture pack fails through the real CLI with file paths and JSON pointers; hooked rules load.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPacks, loadHookRules } from './run';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Fixtures are written at test time under the git-ignored .cache/, so no broken JSON is committed.
const FIXTURE = '.cache/test-fixtures/packs-check';

function write(rel: string, content: unknown): void {
  const file = path.join(root, FIXTURE, rel);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}

beforeAll(() => {
  rmSync(path.join(root, FIXTURE), { recursive: true, force: true });
  const b = 'bad/base';
  write(`${b}/pack.json`, {
    type: 'pack',
    id: 'base',
    name: 'Broken fixture',
    version: '0.1.0',
    formatVersion: 1,
    license: 'MIT',
    defaults: { tuning: 'registry', hud: 'classic' },
  });
  write(`${b}/hud/classic.json`, {
    type: 'hud-layout',
    id: 'classic',
    name: 'Classic',
    mirror: false,
    elements: [],
  });
  write(`${b}/bikes/slowpoke.json`, {
    type: 'bike',
    id: 'slowpoke',
    name: 'Slowpoke',
    class: 'scooter',
    handling: { topSpeedMps: -1, accelMps2: 2, brakeMps2: 6, steerRateMps: 3, massKg: 95 },
    engineSound: { preset: 'buzz' },
  });
  write(`${b}/weapons/long-pipe.json`, {
    type: 'weapon',
    id: 'long-pipe',
    name: 'Long Pipe',
    category: 'blunt',
    behaviour: 'melee.swing',
    unarmed: false,
    reach: { sM: 1.6, dM: 1.4 },
    windupS: 0.34,
    activeS: 0.1,
    recoveryS: 0.42,
    damage: 18,
    steal: { allowed: true, windowStartS: 0.12, windowEndS: 0.5 },
  });
  write(`${b}/weapons/trailing-comma.json`, '{ "type": "weapon", }\n');
  write(
    'hook-rule.ts',
    `export const packRules = [{ id: 'fixture-hook', description: 'fires on every hud layout',
  check: (ctx) => ctx.entries('hud-layout').map((e) => ({ level: 'error', rule: 'fixture-hook', file: e.path, pointer: '', message: 'hooked' })) }];\n`,
  );
  write('not-rules.ts', 'export const nothing = 1;\n');
});

afterAll(() => rmSync(path.join(root, FIXTURE), { recursive: true, force: true }));

describe('packs:check', () => {
  it('passes the real packs, examines every file and writes the index with SHA-256 hashes', async () => {
    const res = await checkPacks({ root, indexDir: `${FIXTURE}/index` });
    expect(res.findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(res.packs).toBeGreaterThanOrEqual(1);
    expect(res.files).toBeGreaterThan(0);
    expect(res.entries).toBeGreaterThan(0);
    const written = JSON.parse(
      readFileSync(path.join(root, FIXTURE, 'index/base/pack.index.json'), 'utf8'),
    ) as {
      files: { path: string; hash: string; bytes: number }[];
    };
    const row = written.files.find((f) => f.path === 'pack.json');
    const bytes = readFileSync(path.join(root, 'packs/base/pack.json'));
    expect(row?.bytes).toBe(bytes.length);
    expect(row?.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('fails a broken pack through the real CLI, with repo paths and JSON pointers', () => {
    const run = spawnSync(process.execPath, ['tools/packs/check.mjs', '--packs', `${FIXTURE}/bad`], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(run.status).toBe(1);
    const out = `${run.stdout}\n${run.stderr}`;
    const pack = `${FIXTURE}/bad/base`;
    expect(out).toContain(`${pack}/weapons/trailing-comma.json: not strict JSON`);
    expect(out).toContain(`${pack}/bikes/slowpoke.json /handling/topSpeedMps:`);
    expect(out).toContain(
      `${pack}/weapons/long-pipe.json /steal/windowEndS: the steal window ends at tick 30`,
    );
    expect(out).toMatch(/\[examined\] 5 pack files in 1 pack\(s\)/);
    expect(out).toContain('packs:check: FAILED');
  }, 30_000);

  it('prints a nonzero examined count for the real packs through the npm entry', () => {
    const run = spawnSync(process.execPath, ['scripts/packs-check.mjs'], { cwd: root, encoding: 'utf8' });
    expect(run.status).toBe(0);
    const n = /\[examined\] (\d+) pack files/.exec(run.stdout)?.[1];
    expect(Number(n)).toBeGreaterThan(0);
  }, 30_000);

  it('loads hooked rules, and reports a hook module without packRules', async () => {
    const good = await loadHookRules(root, [`/${FIXTURE}/hook-rule.ts`]);
    expect(good.findings).toEqual([]);
    expect(good.rules.map((r) => r.id)).toEqual(['fixture-hook']);
    const res = await checkPacks({
      root,
      packsDir: `${FIXTURE}/bad`,
      indexDir: null,
      hookModules: [`/${FIXTURE}/hook-rule.ts`],
    });
    expect(res.rules).toContain('fixture-hook');
    expect(res.findings).toContainEqual(
      expect.objectContaining({ rule: 'fixture-hook', repoFile: `${FIXTURE}/bad/base/hud/classic.json` }),
    );
    const bad = await loadHookRules(root, [`/${FIXTURE}/not-rules.ts`, '/tools/does-not-exist.ts']);
    expect(bad.rules).toEqual([]);
    expect(bad.findings.map((f) => `${f.rule}: ${f.message}`)).toEqual([
      expect.stringMatching(/^hooks: .*packRules/),
    ]);
  });
});
