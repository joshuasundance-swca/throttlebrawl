import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintPacks } from '../../src/content/lint';
import { parsePack, type PackFile } from '../../src/content/parse';
import { packRules } from './pack-rules';

// The road lint as a packs:check hook: on the real base pack it examines every road network and
// finds nothing, and a broken road file in a copy of the pack is reported against that file with
// a JSON pointer.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = path.join(root, 'packs/base');

function packFiles(): PackFile[] {
  const out: PackFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(path.join(dir, d.name), r);
      else if (d.name.endsWith('.json'))
        out.push({ path: r, json: JSON.parse(readFileSync(path.join(dir, d.name), 'utf8')) });
    }
  };
  walk(base, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const roadFindings = (files: PackFile[]) => {
  const { pack } = parsePack(files);
  if (!pack) throw new Error('the base pack did not parse');
  return {
    networks: pack.entries.filter((e) => e.type === 'road-network').length,
    roads: pack.entries.filter((e) => e.type === 'road').length,
    findings: lintPacks([pack], { rules: packRules }).filter((f) => f.rule.startsWith('road-')),
  };
};

describe('tools/road: the road lint hooked into packs:check', () => {
  it('exports the road rule and the lap-count rule, and finds nothing wrong with the real base pack', () => {
    expect(packRules.map((r) => r.id)).toEqual(['roads', 'laps']);
    const res = roadFindings(packFiles());
    console.log(
      `road hook: ${res.networks} networks, ${res.roads} roads examined, ${res.findings.length} findings`,
    );
    expect(res.networks).toBeGreaterThanOrEqual(1);
    expect(res.roads).toBeGreaterThanOrEqual(3);
    expect(res.findings).toEqual([]);
  });

  it('runs in the real packs:check command line (the hook loads while the module runner is open)', () => {
    const out = execFileSync(process.execPath, [path.join(root, 'tools/packs/check.mjs')], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const examined = out.split('\n').find((l) => l.startsWith('[examined]')) ?? '';
    expect(examined).toMatch(/rules: .*\broads\b/);
    expect(examined).toMatch(/; 0 error\(s\)/);
  }, 60_000);

  it('reports a broken road against its pack file, with a JSON pointer', () => {
    const files = packFiles();
    const road = files.find((f) => f.path === 'regions/florida-keys/roads/m1-marina-bends.json');
    const data = (road?.json as { samples: { data: { kappa: number[] } } }).samples.data;
    data.kappa = data.kappa.map(() => 0); // an S-bend that claims to be straight
    const res = roadFindings(files);
    const hit = res.findings.find((f) => f.rule === 'road-curvature');
    expect(hit?.file).toBe('regions/florida-keys/roads/m1-marina-bends.json');
    expect(hit?.pointer).toMatch(/^\/samples\/data\/kappa\/\d+$/);
    expect(hit?.level).toBe('error');
  });

  it('road-3, the lap-count rule: an event length with laps > 1 needs a closed route', () => {
    const files = packFiles();
    const events = files.filter((f) => f.path.startsWith('events/'));
    const withLengths = events.filter((f) => Array.isArray((f.json as { lengths?: unknown }).lengths));
    const lengths = withLengths.flatMap((f) => (f.json as { lengths: unknown[] }).lengths).length;
    console.log(`lap rule: ${withLengths.length} events, ${lengths} lengths examined on the real pack`);
    expect(lengths).toBeGreaterThanOrEqual(1);
    expect(roadFindings(files).findings.filter((f) => f.rule === 'road-laps')).toEqual([]);
    // Two laps of the point-to-point M1 sprint: refused, against the event file and its length.
    const ev = events.find((f) => f.path === 'events/m1-skeleton-sprint.json');
    const j = ev?.json as { lengths: { id: string; route: string; laps: number }[] };
    j.lengths.push({ id: 'twice', route: 'm1-skeleton-sprint', laps: 2 });
    const hits = roadFindings(files).findings.filter((f) => f.rule === 'road-laps');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.file).toBe('events/m1-skeleton-sprint.json');
    expect(hits[0]?.pointer).toBe(`/lengths/${j.lengths.length - 1}/laps`);
    expect(hits[0]?.level).toBe('error');
    expect(hits[0]?.message).toMatch(/closed/);
    // The same length on a closed route passes.
    const route = files.find((f) => f.path === 'regions/florida-keys/routes/m1-skeleton-sprint.json');
    (route?.json as { closed: boolean }).closed = true;
    expect(roadFindings(files).findings.filter((f) => f.rule === 'road-laps')).toEqual([]);
  });
});
