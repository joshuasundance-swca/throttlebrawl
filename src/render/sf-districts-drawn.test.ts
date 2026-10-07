// No visual change (the maintainer, 2026-10-06, [decided]: "consistent physics and gameplay is important here so
// players know what to expect"): the placement of San Francisco's Chinatown, North Beach and Mission moved out of
// render into road/structures/, and render draws the road's layout. This holds what is drawn to what main drew
// before the move (src/render/sf-districts-drawn.golden.json, made by running main's planBlocks and planMission on
// the real networks): every soup's triangle count exactly and its area, mean point and bounds within a stated
// tolerance, and, for the seeds the other tests use (7 for the blocks, 1 for the Mission), every roof quad's
// bounds, so a building that moved, resized or went missing is found. Negative controls: a different seed, a roof
// moved, a roof dropped.
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad, type RoadNetwork } from '../road';
import { planBlocks } from './chinatown-northbeach';
import {
  digestDiffs,
  digestOf,
  roofDiffs,
  roofRows,
  type GoldenSoup,
  type SoupDigest,
} from './district-golden.test-util';
import { MISSION_COLOURS, planMission } from './mission';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`${line}\n`);
const networkFiles = import.meta.glob<BakedNetwork>('../../packs/*/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
interface Entry {
  buildings: number;
  strings?: number;
  trees?: number;
  tables?: number;
  mascots?: number;
  items?: number;
  tower?: { x: number; y: number; z: number } | null;
  soups: Record<string, SoupDigest>;
}
const golden = Object.values(
  import.meta.glob<Record<string, Entry>>('./sf-districts-drawn.golden.json', {
    eager: true,
    import: 'default',
  }),
)[0] as Record<string, Entry>;

/** The tolerance on a drawn point, m: the road's math swapped Math's sin, cos, atan2 and hypot for core's. */
const TOL_M = 0.02;
/** The same for a roof row, in cm (rounded to the centimetre either side). */
const TOL_CM = 2;
const BLOCKS_ROOF = '#8d8579';

function track(id: string): RoadNetwork {
  const [path, network] = Object.entries(networkFiles).find(([, n]) => n.id === id) ?? [];
  if (!network || !path) throw new Error(`no network ${id}`);
  const pack = /packs\/([^/]+)\//.exec(path)?.[1] ?? '';
  const roads = Object.entries(roadFiles)
    .filter(([p, r]) => p.includes(`/packs/${pack}/`) && network.roads.includes(r.id))
    .map(([, r]) => r);
  return createRoadNetwork({ network, roads });
}

const cn = track('sf-chinatown-northbeach');
const mi = track('sf-mission');

/** The soups of a drawn plan as `name -> digest` (and the roofs, for the soups the golden holds them for). */
function drawnBlocks(seed: number) {
  const plan = planBlocks({ road: cn, seed });
  const out = new Map<string, GoldenSoup>();
  for (const [k, s] of plan.near) out.set(`near:${k}`, s);
  for (const [k, s] of plan.far) out.set(`far:${k}`, s);
  return { plan, soups: out };
}
function drawnMission(seed: number) {
  const plan = planMission({ road: mi, seed });
  return { plan, soups: new Map<string, GoldenSoup>(plan.soups) };
}

/** The differences of drawn soups from a golden entry: the soups' names, and each one's digest and roof differences. */
function compare(
  want: Entry,
  soups: ReadonlyMap<string, GoldenSoup>,
  roof: string,
): { names: string[]; digests: string[]; roofs: number } {
  const names = [
    ...Object.keys(want.soups)
      .filter((k) => !soups.has(k))
      .map((k) => `missing ${k}`),
    ...[...soups.keys()].filter((k) => !(k in want.soups)).map((k) => `extra ${k}`),
  ];
  const digests: string[] = [];
  let roofs = 0;
  for (const [name, d] of Object.entries(want.soups)) {
    const soup = soups.get(name);
    if (!soup) continue;
    for (const diff of digestDiffs(d, digestOf(soup), TOL_M)) digests.push(`${name}: ${diff}`);
    if (d.roofs) roofs += roofDiffs(d.roofs, roofRows(soup, roof), TOL_CM);
  }
  return { names, digests, roofs };
}

describe('the districts draw what main drew before the placement moved to road/structures/', () => {
  it('has the golden: both networks, the seeds the other tests use, roofs for the first of each', () => {
    expect(Object.keys(golden).sort()).toEqual([
      'blocks:sf-chinatown-northbeach:7',
      'blocks:sf-chinatown-northbeach:8',
      'mission:sf-mission:1',
      'mission:sf-mission:2',
      'mission:sf-mission:7',
    ]);
    const rows = (e: Entry) => Object.values(e.soups).reduce((n, s) => n + (s.roofs?.length ?? 0), 0);
    expect(rows(golden['blocks:sf-chinatown-northbeach:7'] as Entry)).toBeGreaterThan(1300);
    expect(rows(golden['mission:sf-mission:1'] as Entry)).toBeGreaterThan(2800);
  });

  it.each([7, 8])(
    "Chinatown and North Beach, seed %i: every soup's triangles, area, mean and bounds",
    (seed) => {
      const want = golden[`blocks:sf-chinatown-northbeach:${seed}`] as Entry;
      const { plan, soups } = drawnBlocks(seed);
      const diff = compare(want, soups, BLOCKS_ROOF);
      let tris = 0;
      for (const s of plan.near.values()) tris += s.pos.length / 9;
      print(
        `[examined] blocks seed ${seed}: ${soups.size} soups, ${Math.round(tris)} near triangles, ${plan.buildings.length} buildings: ` +
          `${diff.names.length} soups missing or extra, ${diff.digests.length} digest differences, ${diff.roofs} roof rows off`,
      );
      expect(diff.names).toEqual([]);
      expect(diff.digests).toEqual([]);
      expect(diff.roofs).toBe(0);
      expect(plan.buildings.length).toBe(want.buildings);
      expect(plan.strings.length).toBe(want.strings);
      expect(plan.trees).toBe(want.trees);
      expect(plan.tables.length).toBe(want.tables);
      expect(plan.tower === null).toBe(want.tower === null);
      if (plan.tower && want.tower) {
        expect(Math.abs(plan.tower.x - want.tower.x)).toBeLessThan(TOL_M);
        expect(Math.abs(plan.tower.y - want.tower.y)).toBeLessThan(TOL_M);
        expect(Math.abs(plan.tower.z - want.tower.z)).toBeLessThan(TOL_M);
      }
    },
  );

  it.each([1, 2, 7])("the Mission, seed %i: every soup's triangles, area, mean and bounds", (seed) => {
    const want = golden[`mission:sf-mission:${seed}`] as Entry;
    const { plan, soups } = drawnMission(seed);
    const diff = compare(want, soups, MISSION_COLOURS.roof);
    print(
      `[examined] mission seed ${seed}: ${soups.size} soups, ${plan.buildings.length} buildings: ` +
        `${diff.names.length} soups missing or extra, ${diff.digests.length} digest differences, ${diff.roofs} roof rows off`,
    );
    expect(diff.names).toEqual([]);
    expect(diff.digests).toEqual([]);
    expect(diff.roofs).toBe(0);
    expect(plan.buildings.length).toBe(want.buildings);
    expect(plan.mascots.length).toBe(want.mascots);
    expect(plan.items.length).toBe(want.items);
  });

  it('control: another seed, a roof moved 0.5 m or a roof dropped from the golden is found', () => {
    const want = golden['blocks:sf-chinatown-northbeach:7'] as Entry;
    // Another seed lays other lots.
    const other = compare(want, drawnBlocks(8).soups, BLOCKS_ROOF);
    expect(other.digests.length + other.roofs).toBeGreaterThan(10);
    // One roof moved half a metre, one dropped: the golden is the one doctored.
    const { soups } = drawnBlocks(7);
    const [name, d] = Object.entries(want.soups).find(([, s]) => (s.roofs?.length ?? 0) > 5) as [
      string,
      SoupDigest,
    ];
    const roofs = d.roofs as number[][];
    const moved = roofs.map((r, i) => (i === 3 ? r.map((v, k) => (k < 2 ? v + 50 : v)) : r));
    const dropped = roofs.filter((_r, i) => i !== 3);
    const got = roofRows(soups.get(name) as GoldenSoup, BLOCKS_ROOF);
    expect(roofDiffs(roofs, got, TOL_CM)).toBe(0);
    expect(roofDiffs(moved, got, TOL_CM)).toBeGreaterThan(0);
    expect(roofDiffs(dropped, got, TOL_CM)).toBeGreaterThan(0);
  });
});
