// The downtowns look as they did when their placement moved into the road (the physical world, the
// maintainer, 2026-10-06: "consistent physics and gameplay is important here so players know what to expect
// and how to interact with the world"). road/structures/downtown.ts plans San Francisco's towers and
// Portland's blocks now, and render/downtown.ts draws that plan; downtown-main.fixture.json is what
// render/downtown.ts drew on main before the move, for every seed the downtown tests use (San Francisco's 7
// and 8, Portland's 1, 2, 3, 4 and 7): each building's, cart's and rack's drawn world box, each stretch's
// surfaces and each crossing. This holds the port to it, building by building, within DRAWN_TOLERANCE_M.
//
// Four of Portland's lots differ, named in KNOWN with the reason: main sized its lots from the loaded kit's
// bounding boxes, a few micrometres over the kit's own round sizes (15.000002 m for a 15 m front), and in
// those four places a lot's edge fell exactly on a keep-clear line, so that float error decided it. The
// plan sizes lots from the fixed table now (road/structures.ts STRUCTURE_MODELS), and the same rule, read
// with the round sizes, decides the other way there. Any other difference fails.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { DowntownLayer, LOT_LAND_TOP_M, type DowntownItem } from './downtown';
import fixture from './downtown-main.fixture.json';
import { createFlatLook } from './look';
import { bakeRepoModel } from './model-files.test-util';
import type { RoadDressing } from './road-mesh';
import { LAND_TOP_M } from './scenery';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string): { road: RoadNetwork; dressing: RoadDressing } {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  return { road: createRoadNetwork({ network, roads }), dressing };
}

/** How far a drawn box's face may sit from main's, m: the fixture's centimetre rounding and float noise. */
const DRAWN_TOLERANCE_M = 0.02;
/** What the street furniture is (road/furniture.ts's, not moved here): the fixture leaves it out. */
const FURNITURE = new Set([
  'lamp',
  'planter',
  'hydrant',
  'scooter',
  'board',
  'plaza-planter',
  'bench',
  'orb',
  'signal',
]);

/**
 * The lots that differ from main, by network and seed: what main drew there and what is drawn now, each
 * `rule variant mids` and its drawn box. The reason is the file's header: a lot edge on a keep-clear line,
 * decided by the loaded kit's float error on main and by the fixed table's round sizes now. On Broadway
 * (osm-pnw-pdx-broadway), seed 1: one office block's front stands on the sidewalk's line (3.4 m past the
 * verge) where main set it back 4 m behind a feature whose keep-clear margin its lot's end touched, and on
 * the other side the second row's loft and pink tower trade lots; seed 3: one second-row loft is a pink
 * tower, 3.4 m on. With the kit's exact float sizes in place of the table's, the port drew all five seeds
 * as main did (checked 2026-10-06), so nothing else in the move changes the picture.
 */
const KNOWN: Readonly<Record<string, { main: readonly string[]; now: readonly string[] }>> = {
  'osm-pnw-portland:1': {
    main: [
      'pdx-back 1 - -463.56 -432.3 12.43 38.07 -226.8 -190.92',
      'pdx-back-tower 3 6 -475.29 -444.3 12.77 112.56 -197.87 -163.42',
      'pdx-front 2 - -358.17 -326.9 10.96 39.68 -276.61 -240.73',
    ],
    now: [
      'pdx-back 1 - -474.5 -443.23 12.77 38.56 -198.23 -162.34',
      'pdx-back-tower 3 6 -464.36 -433.37 12.43 112.07 -226.44 -191.99',
      'pdx-front 2 - -361.91 -330.63 10.96 39.68 -278.05 -242.16',
    ],
  },
  'osm-pnw-portland:3': {
    main: ['pdx-back 1 - -474.5 -443.23 12.77 38.56 -198.23 -162.34'],
    now: ['pdx-back-tower 3 5 -476.51 -445.51 12.82 98.62 -194.7 -160.24'],
  },
};

/**
 * Where the land itself has changed since the fixture, by network: x and z bounds of the ground whose lots
 * are not held to main's. The ride column's check (2026-10-06) keeps land from standing over another road's
 * lanes lower than it (render/road-mesh.ts `landOverRoad`, road/land.ts the same rule), and beside the
 * Hawthorne Bridge road that land ran over the Morrison links below it; it stops short of their lanes now,
 * so the lots planned on it differ. A row whose drawn box's middle lies here is left out of both sides;
 * portland-blocks.test.ts still holds every building there to the land the road scene draws.
 */
const LAND_CHANGED: Readonly<Record<string, readonly { x0: number; x1: number; z0: number; z1: number }[]>> =
  {
    'osm-pnw-portland': [{ x0: 960, x1: 1055, z0: 725, z1: 855 }],
  };
/**
 * The stretches of surfaces, by network and key, that the same rule trims a few triangles from (their land
 * stops short of a lower road's lanes too); their extent is held as before.
 */
const SURFACES_CHANGED: Readonly<Record<string, ReadonlySet<string>>> = {
  'osm-pnw-portland': new Set(['4:0', '7:7']),
};

const c2 = (v: number) => {
  const s = (Math.round(v * 100) / 100).toFixed(2);
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

/** An item's drawn world box, as the fixture writes it: `rule variant mids x0 x1 y0 y1 z0 z1`. */
function rowOf(layer: DowntownLayer, it: DowntownItem): string {
  const pts = layer.drawnPoints(it);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pts.length; i += 3)
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k] ?? 0, pts[i + k] ?? 0);
      hi[k] = Math.max(hi[k] ?? 0, pts[i + k] ?? 0);
    }
  const box = [lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]].map((v) => c2(v ?? 0));
  return [it.rule, it.variant, it.mids ?? '-', ...box].join(' ');
}

/** Splits a row into its name (its first `named` words: `rule variant mids`, or a stretch's key and count) and its numbers. */
const parse = (row: string, named = 3) => {
  const parts = row.split(' ');
  return { name: parts.slice(0, named).join(' '), box: parts.slice(named).map(Number) };
};

/**
 * Pairs each of main's rows with an unused row of now's of the same name whose box lies within the
 * tolerance, and returns the rows of each left over.
 */
function unpaired(
  main: readonly string[],
  now: readonly string[],
  named = 3,
): { main: string[]; now: string[]; worst: number } {
  const left = now.map((row) => parse(row, named));
  const used = new Set<number>();
  const lost: string[] = [];
  let worst = 0;
  for (const row of main) {
    const m = parse(row, named);
    let best = -1;
    let bestGap = Infinity;
    left.forEach((n, i) => {
      if (used.has(i) || n.name !== m.name) return;
      const gap = Math.max(...n.box.map((v, k) => Math.abs(v - (m.box[k] ?? 0))));
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    });
    if (best < 0 || bestGap > DRAWN_TOLERANCE_M) lost.push(row);
    else {
      used.add(best);
      worst = Math.max(worst, bestGap);
    }
  }
  return { main: lost.sort(), now: now.filter((_, i) => !used.has(i)).sort(), worst };
}

const look = createFlatLook();
const KIT = await bakeRepoModel('sfDowntown');
const PROPS = await bakeRepoModel('sfRoadside');
const CABLE = await bakeRepoModel('cableCar');
const MODULES = await bakeRepoModel('sfTowerModules');
const PDX = await bakeRepoModel('pdxDowntown');
const tracks = new Map<string, ReturnType<typeof track>>();
const layerOf = (network: string, seed: number): DowntownLayer => {
  let t = tracks.get(network);
  if (!t) tracks.set(network, (t = track(network)));
  const input = { road: t.road, dressing: t.dressing, seed };
  return network === 'osm-pnw-portland'
    ? new DowntownLayer(PDX, undefined, undefined, look, { ...input, portland: true })
    : new DowntownLayer(KIT, PROPS, CABLE, look, input, MODULES);
};

describe("the downtowns draw as main drew them (the placement's move into the road, 2026-10-06)", () => {
  it('stands the lots on the land the road scene draws: the same top over the road', () => {
    expect(LOT_LAND_TOP_M).toBe(LAND_TOP_M);
  });

  for (const plan of fixture.plans) {
    it(`${plan.network}, seed ${plan.seed}: every building, cart and rack, every stretch of surfaces and every crossing`, () => {
      const layer = layerOf(plan.network, plan.seed);
      const changed = LAND_CHANGED[plan.network] ?? [];
      const held = (row: string) => {
        const { box } = parse(row);
        const x = ((box[0] ?? 0) + (box[1] ?? 0)) / 2;
        const z = ((box[4] ?? 0) + (box[5] ?? 0)) / 2;
        return !changed.some((a) => x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1);
      };
      const all = layer.plan.items.filter((it) => !FURNITURE.has(it.rule)).map((it) => rowOf(layer, it));
      const now = all.filter(held);
      const main = plan.items.filter(held);
      // The changed ground still has its buildings (the check would pass vacuously on an empty block).
      if (changed.length) expect(all.length - now.length, 'drawn on the changed ground').toBeGreaterThan(0);
      const known = KNOWN[`${plan.network}:${plan.seed}`] ?? { main: [], now: [] };
      const diff = unpaired(main, now);
      expect(diff.main, 'drawn on main, not now').toEqual([...known.main].sort());
      expect(diff.now, 'drawn now, not on main').toEqual([...known.now].sort());
      expect(now.length).toBe(main.length);
      // The surfaces: the same stretches, the same triangles, the same extent.
      const soups = [...layer.plan.soups.entries()].map(([key, s]) => {
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < s.pos.length; i += 3)
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k] ?? 0, s.pos[i + k] ?? 0);
            hi[k] = Math.max(hi[k] ?? 0, s.pos[i + k] ?? 0);
          }
        return [
          key,
          s.pos.length / 3,
          ...[lo[0], hi[0], lo[1], hi[1], lo[2], hi[2]].map((v) => c2(v ?? 0)),
        ].join(' ');
      });
      // A stretch the changed land runs beside keeps its extent but may lose triangles (never gain them):
      // compared by its key and extent, and its count held to at most main's.
      const trimmed = SURFACES_CHANGED[plan.network] ?? new Set<string>();
      const counts = new Map<string, number>();
      const byKey = (row: string, side: 'main' | 'now') => {
        const [key, count, ...box] = row.split(' ');
        if (!key || !trimmed.has(key)) return row;
        counts.set(`${side} ${key}`, Number(count));
        return [key, '*', ...box].join(' ');
      };
      const soupDiff = unpaired(
        plan.soups.map((r) => byKey(r, 'main')),
        soups.map((r) => byKey(r, 'now')),
        2,
      );
      for (const key of trimmed)
        expect(counts.get(`now ${key}`) ?? 0, `${key}: triangles now against main's`).toBeLessThanOrEqual(
          counts.get(`main ${key}`) ?? 0,
        );
      expect(soupDiff.main, 'surfaces on main, not now').toEqual([]);
      expect(soupDiff.now, 'surfaces now, not on main').toEqual([]);
      const crossings = layer.plan.crossings.map((c) =>
        [c.edge, c2(c.s), c2(c.half), c.cable ? 1 : 0, c2(c.outer), c2(c.roadY)].join(' '),
      );
      expect(crossings).toEqual(plan.crossings);
      stdout.write(
        `[examined] ${plan.network} seed ${plan.seed}: ${now.length} drawn buildings, carts and racks against main's ${main.length} (${all.length - now.length} now and ${plan.items.length - main.length} on main left out on changed ground; worst face ${diff.worst.toFixed(3)} m, ${known.now.length} known lots differ), ${soups.length} stretches of surfaces, ${crossings.length} crossings\n`,
      );
      layer.dispose();
    });
  }

  it('finds a building moved or resized by more than the tolerance, and a missing one (the control)', () => {
    const plan = fixture.plans[0];
    if (!plan) throw new Error('no fixture plans');
    const [first, ...rest] = plan.items;
    if (!first) throw new Error('no fixture rows');
    const { name, box } = parse(first);
    const moved = [name, ...box.map((v, k) => (k === 0 || k === 1 ? v + 0.05 : v))].join(' ');
    expect(unpaired(plan.items, [moved, ...rest]).main).toEqual([first]);
    const taller = [name, ...box.map((v, k) => (k === 3 ? v + 0.05 : v))].join(' ');
    expect(unpaired(plan.items, [taller, ...rest]).now).toEqual([taller]);
    expect(unpaired(plan.items, rest).main).toEqual([first]);
    expect(unpaired(plan.items, plan.items).main).toEqual([]);
  });
});
