import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

// Playtest 3's real places in the Pacific Northwest (T9.4): Bridge City, downtown Portland and its
// bridges (the maintainer, 2026-10-03, round 1: "Duval St, downtown Portland, Golden Gate"). The
// success criteria are the plan's (scratch/pt3/real-world.md, 5.5): a route from East Burnside over
// the Burnside Bridge, along West Burnside to Broadway, south past Pioneer Courthouse Square, east on
// Madison and over the Hawthorne Bridge; a choice "Pick your bridge" over the Morrison Bridge that is
// kept only if it comes within 15% of the leg it replaces; the lift towers where the real bridge
// lifts. The road lint, the scenery-on-land walk and the geometry sweeps run on this network in
// region-routes.test.ts and tests/sim/geometry-*.test.ts; the bot races it in
// tests/sim/road-real-routes.test.ts. This file holds what only Bridge City asks.

const REGION = 'packs/region-pnw/regions/pacific-northwest';
const NETWORK = 'osm-pnw-portland';
const ROUTE = 'osm-bridge-city-run';

interface Tag {
  s0: number;
  s1: number;
  tag: string;
}
interface Feature {
  kind: string;
  id: string;
  s0: number;
  s1: number;
  d0: number;
  d1: number;
  item?: string;
  params?: Record<string, unknown>;
}
interface Road {
  id: string;
  lengthM: number;
  realName?: string | null;
  tags?: Tag[];
  features?: Feature[];
  laneSections: { lanes: { kind: string; direction: number }[] }[];
  samples: { data: Record<string, number[]> };
}
interface Route {
  id: string;
  name: string;
  network: string;
  mainPath: string[];
  allowedRoads: string[];
  branches: { id: string; sign?: string; roads: string[] }[];
}
interface Junction {
  connectors: {
    road: string;
    from: { road: string; lane: string };
    splitZone?: { s0: number; d0: number; d1: number };
  }[];
}
interface BakedNetwork {
  roads: string[];
  region: string;
  junctions: Junction[];
}
interface Report {
  branches: { id: string; mainM: number; branchM: number; savesM: number }[];
  landmarks: { id: string; road: string; s: number; d: number; placementErrorM: number }[];
  lines: Record<string, { driftClosedM: Record<string, number> }>;
}

const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const network = read<BakedNetwork>(`${REGION}/networks/${NETWORK}.json`);
const route = read<Route>(`${REGION}/routes/${ROUTE}.json`);
const road = (id: string) => read<Road>(`${REGION}/roads/${id}.json`);
const roads = new Map(network.roads.map((id) => [id, road(id)]));
const report = read<Report>(`tools/gis/reports/${NETWORK}.network.json`);
const regionFile = read<{
  networks: string[];
  signs: { id: string; text: string; tags?: string[] }[];
}>(`${REGION}/region.json`);

const lengthOf = (ids: readonly string[]) => ids.reduce((n, id) => n + (roads.get(id)?.lengthM ?? 0), 0);
/** The total length of a road's `bridge` tag ranges. */
const bridgeM = (r: Road) =>
  (r.tags ?? []).filter((t) => t.tag === 'bridge').reduce((n, t) => n + (t.s1 - t.s0), 0);

/** The plan's rule for a junction choice: it stays within this share of the leg it replaces. */
const CHOICE_TOLERANCE = 0.15;
const withinTolerance = (mainM: number, branchM: number) =>
  Math.abs(branchM - mainM) / mainM <= CHOICE_TOLERANCE;

describe('Bridge City: downtown Portland', () => {
  it('is a real-road network of the Pacific Northwest, listed by its region, with one route', () => {
    expect(network.region).toBe('pacific-northwest');
    expect(regionFile.networks).toContain(NETWORK);
    expect(route.network).toBe(NETWORK);
    expect(route.name).toBe('Bridge City');
  });

  it("runs the plan's streets in order: Burnside, its bridge, Broadway, Madison, the Hawthorne Bridge", () => {
    const names = route.mainPath.map((id) => roads.get(id)?.realName ?? id);
    // A street cut in two by the choice's junction piece is still one street.
    const streets = names.filter((n, i) => n !== names[i - 1]);
    expect(streets).toEqual([
      'East Burnside Street',
      'Burnside Bridge',
      'West Burnside Street',
      'Southwest Broadway',
      'Southwest Madison Street',
      'Hawthorne Bridge',
      'Southeast Hawthorne Boulevard',
    ]);
    expect(route.mainPath[0]).toBe('osm-pnw-pdx-east-burnside');
    expect(route.mainPath.at(-1)).toBe('osm-pnw-pdx-se-hawthorne');
  });

  it('is a race of 4 to 5.5 km (the plan estimated 4.2 km) over two real bridges, each deck at least its 421 m', () => {
    const km = lengthOf(route.mainPath) / 1000;
    expect(km).toBeGreaterThan(4);
    expect(km).toBeLessThan(5.5);
    for (const name of ['Burnside Bridge', 'Hawthorne Bridge']) {
      const decks = route.mainPath.map((id) => roads.get(id)).filter((r) => r?.realName === name);
      expect(decks.length, name).toBeGreaterThan(0);
      expect(
        decks.reduce((n, r) => n + (r ? bridgeM(r) : 0), 0),
        name,
      ).toBeGreaterThanOrEqual(421);
    }
  });

  it("keeps the plan's two lanes each way on Burnside", () => {
    const lanes = roads.get('osm-pnw-pdx-burnside-bridge')?.laneSections[0]?.lanes ?? [];
    const drive = lanes.filter((l) => l.kind === 'drive');
    expect(drive.filter((l) => l.direction === 1)).toHaveLength(2);
    expect(drive.filter((l) => l.direction === -1)).toHaveLength(2);
  });

  it('has the Morrison Bridge choice within 15% of the leg it replaces (the plan kept it only if so)', () => {
    const [branch] = route.branches;
    expect(route.branches).toHaveLength(1);
    expect(branch?.roads.some((id) => roads.get(id)?.realName === 'Morrison Bridge')).toBe(true);
    // The leg it replaces: the two junction pieces (the roads the route allows that are neither on
    // the main path nor the branch's) and the main roads between them.
    const pieces = route.allowedRoads.filter(
      (id) => !route.mainPath.includes(id) && !branch!.roads.includes(id),
    );
    expect(pieces).toHaveLength(2);
    const connectors = network.junctions.flatMap((j) => j.connectors);
    const fromRoad = (piece: string) => connectors.find((c) => c.road === piece)?.from.road ?? '';
    const between = route.mainPath.slice(
      route.mainPath.indexOf(fromRoad(pieces[0]!)) + 1,
      route.mainPath.indexOf(fromRoad(pieces[1]!)) + 1,
    );
    expect(between.length).toBeGreaterThan(0);
    const mainM = lengthOf(pieces) + lengthOf(between);
    const branchM = lengthOf(branch!.roads);
    process.stdout.write(
      `[examined] Pick your bridge: the Morrison Bridge way ${branchM.toFixed(0)} m for ${mainM.toFixed(0)} m of ` +
        `main road (${between.length} roads and 2 junction pieces); the bake's own report says ` +
        `${report.branches[0]?.savesM} m saved\n`,
    );
    expect(withinTolerance(mainM, branchM)).toBe(true);
    // Negative control: the same rule refuses a way 40% longer, and one 40% shorter.
    expect(withinTolerance(mainM, mainM * 1.4)).toBe(false);
    expect(withinTolerance(mainM, mainM * 0.6)).toBe(false);
  });

  it('leaves for the Morrison Bridge on the left, with a sign standing on that side before the split zone', () => {
    const connector = network.junctions.flatMap((j) => j.connectors).find((c) => c.splitZone !== undefined);
    expect(connector, 'a split zone').toBeDefined();
    const zone = connector!.splitZone!;
    expect(zone.d0).toBeLessThan(0);
    expect(zone.d1).toBeLessThan(0);
    const leaving = roads.get(connector!.from.road);
    const sign = leaving?.features?.find((f) => f.kind === 'billboard' && f.item === 'morrison-keep-left');
    expect(sign, 'the junction sign stands on the road the branch leaves').toBeDefined();
    expect(sign!.d1).toBeLessThan(0);
    expect(zone.s0 - sign!.s1).toBeGreaterThanOrEqual(30);
    // The sign is the route's own, a `site` board that no pooled slot elsewhere can pick.
    const board = regionFile.signs.find((s) => s.id === 'morrison-keep-left');
    expect(board?.tags).toContain('site');
    expect(board?.text).toBe(route.branches[0]?.sign);
  });

  it('stands the Hawthorne lift towers at the ends of the real lift span, astride the deck', () => {
    const towers = report.landmarks.filter((l) => l.id.startsWith('hawthorne-lift-tower'));
    expect(towers).toHaveLength(2);
    const [a, b] = towers.sort((x, y) => x.s - y.s);
    expect(a!.road).toBe('osm-pnw-pdx-hawthorne-bridge');
    expect(b!.road).toBe(a!.road);
    // OSM's movable (lift) span is 75 m; the baked road is a smoothed copy, so allow 8 m.
    expect(Math.abs(b!.s - a!.s - 75)).toBeLessThanOrEqual(8);
    for (const t of towers) {
      expect(Math.abs(t.d), t.id).toBeLessThanOrEqual(1);
      expect(t.placementErrorM, t.id).toBeLessThanOrEqual(6);
    }
    const placed = (roads.get(a!.road)?.features ?? []).filter((f) => f.kind === 'landmark');
    expect(placed.map((f) => f.params?.['overRoad'])).toEqual([true, true]);
    // The kit is the plan's Portland kit; the node is the plan's tower module (CX4 builds both).
    for (const f of placed) expect(f.params?.['model']).toBe('pdx-landmarks#pdx_lift_tower');
  });

  it('pins each of its junctions back within 15 m of the real map (the closure, as the other networks do)', () => {
    for (const [line, info] of Object.entries(report.lines))
      for (const [where, m] of Object.entries(info.driftClosedM))
        expect(m, `${line} ${where}`).toBeLessThanOrEqual(15);
  });

  it('is cheap to fetch: its road files, minified as the build writes them, stay under 75 KB gzip', () => {
    const files = [
      ...network.roads.map((id) => `${REGION}/roads/${id}.json`),
      `${REGION}/networks/${NETWORK}.json`,
      `${REGION}/routes/${ROUTE}.json`,
    ];
    const blob = Buffer.from(
      files.map((f) => JSON.stringify(JSON.parse(readFileSync(f, 'utf8')))).join('\n'),
    );
    const kb = gzipSync(blob, { level: 9 }).length / 1000;
    process.stdout.write(
      `[examined] Bridge City: ${files.length} files, ${(blob.length / 1000).toFixed(0)} KB raw, ${kb.toFixed(1)} KB gzip\n`,
    );
    expect(kb).toBeLessThan(75);
  });
});
