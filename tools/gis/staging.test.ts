import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkPacks } from '../packs/run';
import { buildSimConfig, type ActionState } from '../../src/app';
import { basePackFiles, buildRegistry, lookup, type ContentRegistry } from '../../src/content';
import type { PackFile } from '../../src/content/parse';
import { createBot } from '../../src/dev';
import { createSim, quantizeInput, type SimConfig } from '../../src/sim/api';
import { activateRegion, type RegionStream } from '../../src/stream';

// The head-start bakes for the new regions (Pacific Northwest, San Francisco) sit in
// tools/gis/staging/<region>/ until their region packs exist. This test drops them into a copy of
// the base pack, next to a stand-in region file, and runs the real pack check (schema, refs,
// licence rules, the road lint hook) and a bot race on every staged route, so the staged files are
// known to land cleanly when the region packs are ready.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGING = path.join(root, 'tools/gis/staging');
const SCRATCH = '.cache/gis-staging-check';
const RACES = process.env['GIS_STAGING_RACES'] === '1';

interface Staged {
  region: string;
  networkId: string;
  routeIds: string[];
  /** Pack-relative path -> parsed JSON, for every staged file of this network. */
  files: PackFile[];
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function staged(): Staged[] {
  const out: Staged[] = [];
  for (const region of readdirSync(STAGING)) {
    const dir = path.join(STAGING, region);
    const netDir = path.join(dir, 'networks');
    if (!existsSync(netDir)) continue;
    for (const nf of readdirSync(netDir).filter((f) => f.endsWith('.json'))) {
      const network = readJson(path.join(netDir, nf)) as { id: string; roads: string[] };
      const routeIds = readdirSync(path.join(dir, 'routes'))
        .filter((f) => f.endsWith('.json'))
        .filter((f) => (readJson(path.join(dir, 'routes', f)) as { network: string }).network === network.id)
        .map((f) => f.replace(/\.json$/, ''));
      const files: PackFile[] = [
        { path: `regions/${region}/networks/${nf}`, json: network },
        ...network.roads.map((id) => ({
          path: `regions/${region}/roads/${id}.json`,
          json: readJson(path.join(dir, 'roads', `${id}.json`)),
        })),
        ...routeIds.map((id) => ({
          path: `regions/${region}/routes/${id}.json`,
          json: readJson(path.join(dir, 'routes', `${id}.json`)),
        })),
      ];
      out.push({ region, networkId: network.id, routeIds, files });
    }
  }
  return out;
}

/** A stand-in region file until the real region pack lands: the Keys region with its id swapped. */
function regionStub(region: string, networks: string[]): PackFile {
  const keys = readJson(path.join(root, 'packs/base/regions/florida-keys/region.json')) as Record<
    string,
    unknown
  >;
  return {
    path: `regions/${region}/region.json`,
    json: { ...keys, id: region, name: `${region} (staging stand-in)`, networks },
  };
}

const STAGED = staged();
const REGIONS = [...new Set(STAGED.map((s) => s.region))];
const stubs = REGIONS.map((r) =>
  regionStub(
    r,
    STAGED.filter((s) => s.region === r).map((s) => s.networkId),
  ),
);
const allFiles = (): PackFile[] => [...basePackFiles(), ...stubs, ...STAGED.flatMap((s) => s.files)];

function blank(): ActionState {
  return {
    throttle: 0,
    brake: 0,
    steer: 0,
    attack: false,
    attackSide: 0,
    kick: false,
    lookBack: false,
    skipRunBack: false,
  };
}

function streamFor(reg: ContentRegistry, networkId: string): RegionStream {
  const network = lookup(reg.networks, networkId);
  return activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
}

function botRace(reg: ContentRegistry, networkId: string, routeId: string, seed: number) {
  const defaultRoute = lookup(reg.routes, lookup(reg.events, 'm1-skeleton-sprint').lengths[0]!.route);
  const base = buildSimConfig(reg, streamFor(reg, defaultRoute.network), { seed });
  const real = streamFor(reg, networkId);
  // The field without the cop, as in the Keys real-road test: this proves the road.
  const riders = base.riders.filter((r) => r.faction !== 'law');
  const config: SimConfig = {
    ...base,
    riders,
    road: real.road,
    route: real.routeFor(lookup(reg.routes, routeId)),
  };
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const edges: number[] = [];
  let invalid = 0;
  let crashes = 0;
  let airborne = 0;
  let finishTick = -1;
  while (!sim.isOver() && sim.tick < 60 * 900) {
    const a = blank();
    bot.drive(sim.snapshot(), playerId, config.route, a);
    sim.step([quantizeInput({ ...a, flags: 0 })]);
    for (const e of sim.events()) {
      if (e.actor !== playerId) continue;
      if (e.type === 'crash') crashes++;
      if (e.type === 'land') airborne++;
    }
    const snap = sim.snapshot();
    for (const m of snap.entities) {
      const fields = [m.x, m.y, m.z, m.heading, m.speed, m.road.s, m.road.d];
      if (!fields.every(Number.isFinite) || m.road.s < 0 || m.road.s > config.route.edgeLength(m.road.edge))
        invalid++;
    }
    const me = snap.entities[playerId];
    if (me?.mode === 'Road' && edges[edges.length - 1] !== me.road.edge) edges.push(me.road.edge);
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
  }
  const roadCount = lookup(reg.networks, networkId).roads.length;
  return { sim, edges, invalid, crashes, airborne, finishTick, roadCount };
}

describe('gis staging: the new-region bakes land cleanly', () => {
  beforeAll(() => {
    // A copy of the base pack plus the staged files and stand-in regions, for the real pack check.
    const dir = path.join(root, SCRATCH);
    rmSync(dir, { recursive: true, force: true });
    cpSync(path.join(root, 'packs/base'), path.join(dir, 'base'), { recursive: true });
    for (const f of [...stubs, ...STAGED.flatMap((s) => s.files)]) {
      const out = path.join(dir, 'base', f.path);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(f.json, null, 2)}\n`);
    }
  });
  afterAll(() => rmSync(path.join(root, SCRATCH), { recursive: true, force: true }));

  it('finds the staged networks: 2 in the Pacific Northwest, 2 in San Francisco', () => {
    const by = Object.fromEntries(REGIONS.map((r) => [r, STAGED.filter((s) => s.region === r).length]));
    console.log(
      `staged: ${STAGED.map((s) => `${s.region}/${s.networkId} (${s.files.length} files)`).join(', ')}`,
    );
    expect(by).toEqual({ 'pacific-northwest': 2, 'san-francisco': 2 });
    for (const s of STAGED) expect(s.routeIds.length).toBeGreaterThan(0);
  });

  it('passes the real pack check (schema, refs, licences, the road lint) inside a copy of the base pack', async () => {
    const res = await checkPacks({ root, packsDir: SCRATCH, indexDir: null });
    const errors = res.findings.filter((f) => f.level === 'error');
    console.log(
      `pack check on base + staging: ${res.files} files, ${res.entries} entries, rules ${res.rules.join(',')}, ` +
        `${errors.length} errors`,
    );
    expect(res.rules).toContain('roads');
    expect(errors.map((f) => `${f.repoFile} ${f.pointer} ${f.message}`)).toEqual([]);
    // Negative control: a staged road with a bent curvature column must fail the same check.
    const s = STAGED[0]!;
    const roadFile = s.files[1]!;
    const bent = structuredClone(roadFile.json) as { samples: { data: { kappa: number[] } } };
    const k = bent.samples.data.kappa;
    for (const i of [200, 201, 202]) k[i] = (k[i] ?? 0) + 0.02;
    writeFileSync(path.join(root, SCRATCH, 'base', roadFile.path), JSON.stringify(bent));
    const broken = await checkPacks({ root, packsDir: SCRATCH, indexDir: null });
    const caught = broken.findings.filter((f) => f.level === 'error').map((f) => `${f.rule} ${f.repoFile}`);
    expect(caught).toContain(`road-curvature ${SCRATCH}/base/${roadFile.path}`);
    writeFileSync(path.join(root, SCRATCH, 'base', roadFile.path), JSON.stringify(roadFile.json));
  }, 60_000);

  it('every staged file carries ODbL provenance and the osm- prefix the licence rule matches', () => {
    for (const s of STAGED) {
      for (const f of s.files) {
        expect(path.basename(f.path)).toMatch(/^osm-/);
        const json = f.json as {
          provenance?: { sources?: { spdx?: string }[] };
          meta?: { provenance?: { sources?: { spdx?: string }[] } };
        };
        const sources = json.provenance?.sources ?? json.meta?.provenance?.sources ?? [];
        expect(
          sources.some((src) => src.spdx === 'ODbL-1.0'),
          f.path,
        ).toBe(true);
      }
    }
  });

  // The bot races take about 15-25 s each on the dev machine, so they run on demand
  // (GIS_STAGING_RACES=1) rather than in every push's unit tier: staged files are not in the game
  // yet. Landing a stretch in its region pack moves its race into the gated real-road test.
  for (const s of RACES ? STAGED : []) {
    for (const routeId of s.routeIds) {
      it(`the bot finishes ${s.region}/${routeId}, every road in order, every tick valid`, () => {
        const reg = buildRegistry(allFiles());
        const run = botRace(reg, s.networkId, routeId, 7);
        console.log(
          `${s.region}/${routeId}: bot finished in ${(run.finishTick / 60).toFixed(1)} s, ` +
            `race over at ${(run.sim.tick / 60).toFixed(1)} s, edges ${run.edges.join('>')}, ` +
            `${run.crashes} crashes, ${run.airborne} landings`,
        );
        expect(run.sim.isOver()).toBe(true);
        expect(run.finishTick).toBeGreaterThan(0);
        expect(run.edges).toEqual([...Array(run.roadCount).keys()]);
        expect(run.invalid).toBe(0);
      }, 180_000);
    }
  }
});
