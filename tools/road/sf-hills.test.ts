import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
} from '../../src/road';
import { PACK, SF_HILLS } from './tracks/sf-hills';

// The San Francisco track as baked into the region-sf pack (playtest 1c): the files are fresh,
// pass the schemas and the road lint, and the course has the region's character: steep blocks
// whose crest lips throw a bike into the air at any racing speed and land it on straight road,
// tight switchbacks with a shorter stair-alley shortcut, and a slot for every sign and billboard.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const regionDir = path.join(root, 'packs', PACK, 'regions/san-francisco');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(regionDir, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(SF_HILLS);
const network = read('networks', 'sf-hills') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'sf-standard-run') as BakedRoute;
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);
const region = read('', 'region') as { signs: { id: string }[]; billboards: { id: string }[] };
/** The region items named by board slots on the region's real-road (`osm-*`) roads. */
const realRoadBoardItems = (): Set<string> =>
  new Set(
    readdirSync(path.join(regionDir, 'roads'))
      .filter((f) => f.startsWith('osm-') && f.endsWith('.json'))
      .flatMap(
        (f) => (JSON.parse(readFileSync(path.join(regionDir, 'roads', f), 'utf8')) as BakedRoad).features,
      )
      .flatMap((f) => (f?.kind === 'billboard' && f.item ? [f.item] : [])),
  );
const G = 9.81;

describe('tools/road: the baked San Francisco track', () => {
  it('bakes into the region-sf pack and is fresh: the files equal a new compile of tracks/sf-hills.ts', () => {
    expect(PACK).toBe('region-sf');
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect([route]).toEqual(compiled.routes);
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(lintRoadNetwork({ network, roads, routes: [route] })).toEqual([]);
  });

  it('is a standard-length city course of about 4 km, with tight corners and steep blocks', () => {
    console.log(
      `SF track: ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    expect(progress.length).toBeGreaterThan(3600);
    expect(progress.length).toBeLessThan(4400);
    expect(progress.mainEdges.map((e) => net.edges[e]?.id)).toEqual([
      'sf-pier-row',
      'sf-cable-line-grade',
      'c-switchback-split-main',
      'sf-switchback-street',
      'c-switchback-merge-main',
      'sf-painted-row',
      'c-sf-park-split-main',
      'sf-fogline-climb',
      'c-sf-park-merge-main',
      'sf-bridge-onramp',
      'sf-bridge-approach',
    ]);
    // Switchbacks: tighter than a 40 m radius. Steep blocks: grades of 15 % or more.
    const ks = roads.flatMap((r) => r.samples.data['kappa'] ?? []).map(Math.abs);
    expect(Math.max(...ks)).toBeGreaterThan(1 / 40);
    const grades = roads
      .filter((r) => !r.id.startsWith('sf-stair-alley'))
      .flatMap((r) => r.samples.data['grade'] ?? [])
      .map(Math.abs);
    expect(Math.max(...grades)).toBeGreaterThan(0.15);
  });

  it('finishes on a freeway: two lanes each way, then three, the inner ones the course own (W-R)', () => {
    const e = net.edgeIndex('sf-bridge-approach');
    const drive = (s: number, dir: 1 | -1) =>
      net
        .lanesAt(e, s)
        .filter((l) => l.kind === 'drive' && l.direction === dir)
        .map((l) => l.dCenterM);
    expect(drive(10, 1)).toEqual([2, 6]);
    expect(drive(10, -1)).toEqual([-6, -2]);
    expect(drive(100, 1)).toEqual([2, 6, 10]);
    expect(drive(100, -1)).toEqual([-10, -6, -2]);
    // The finish line is on the six-lane stretch, and the on-ramp is the course's two-lane road.
    expect(progress.finish.edge).toBe(e);
    expect(drive(progress.finish.s, 1)).toHaveLength(3);
    const ramp = net.edgeIndex('sf-bridge-onramp');
    expect(net.lanesAt(ramp, 30).filter((l) => l.kind === 'drive')).toHaveLength(2);
    // Lane splitting room: 4 m lanes leave 2.2 m between two 1.8 m cars, for a 0.8 m bike.
    expect(net.lanesAt(e, 100).every((l) => l.kind !== 'drive' || l.widthM === 4)).toBe(true);
  });

  it('crest lips: a bike leaving one at 20 to 45 m/s flies, and lands softly on straight road', () => {
    let lips = 0;
    for (const r of roads) {
      const y = r.samples.data['y'] ?? [];
      const g = r.samples.data['grade'] ?? [];
      const k = r.samples.data['kappa'] ?? [];
      const sp = r.sampleSpacingM;
      for (const f of (r.features ?? []).filter((x) => x.kind === 'ramp')) {
        lips++;
        let lip = Math.floor(f.s0 / sp);
        for (let i = lip; i <= Math.ceil(f.s1 / sp); i++) if ((y[i] ?? 0) > (y[lip] ?? 0)) lip = i;
        const slope = ((y[lip] ?? 0) - (y[lip - 1] ?? 0)) / sp;
        for (const v of [20, 30, 44.7]) {
          // Ballistic from the lip at speed v along its slope, until it meets the surface.
          const vx = v / Math.sqrt(1 + slope * slope);
          const vy0 = vx * slope;
          let land = -1;
          for (let i = lip + 1; i < y.length && land < 0; i++) {
            const t = ((i - lip) * sp) / vx;
            if ((y[lip] ?? 0) + vy0 * t - 0.5 * G * t * t <= (y[i] ?? 0)) land = i;
          }
          expect(land, `${f.id} at ${v} m/s lands on its own road`).toBeGreaterThan(lip + 2);
          const flight = (land - lip) * sp;
          expect(flight, `${f.id} at ${v} m/s`).toBeGreaterThan(8);
          // Coming down into the slope: under the sim's hard-landing wobble (LANDING_WOBBLE_VERTICAL,
          // 14 m/s, in src/sim/riders), so a straight landing is clean at every racing speed.
          const t = flight / vx;
          const vertical = (g[land] ?? 0) * vx - (vy0 - G * t);
          expect(vertical, `${f.id} at ${v} m/s`).toBeLessThan(14);
          for (let i = lip; i <= land; i++)
            expect(Math.abs(k[i] ?? 0), `${f.id} s ${i * sp}`).toBeLessThan(0.002);
        }
      }
    }
    // Two blocks and the fog climb on the main road, and the stairs on the alley.
    expect(lips).toBe(4);
  });

  it('the stair alley shortcut is shorter than the switchbacks it skips', () => {
    const len = (id: string) => roads.find((r) => r.id === id)?.lengthM ?? 0;
    const main =
      len('c-switchback-split-main') + len('sf-switchback-street') + len('c-switchback-merge-main');
    const alley = len('c-stair-alley-in') + len('sf-stair-alley') + len('c-stair-alley-out');
    expect(alley).toBeLessThan(main - 50);
    // Two splits: the stair alley and (run W-R) the park cut.
    expect(net.splitZones().length).toBe(2);
  });

  it('run W-R: the park cut is a marked dirt shortcut past the Fogline Climb, flat where the climb rises', () => {
    const len = (id: string) => roads.find((r) => r.id === id)?.lengthM ?? 0;
    const main = len('c-sf-park-split-main') + len('sf-fogline-climb') + len('c-sf-park-merge-main');
    const cut = len('c-sf-park-in') + len('sf-park-cut') + len('c-sf-park-out');
    expect(cut).toBeLessThan(main);
    const park = roads.find((r) => r.id === 'sf-park-cut');
    expect(park?.surface).toBe('dirt');
    const ys = park?.samples.data['y'] ?? [];
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1);
    const branch = progress.branches.find((b) => b.id === 'sf-park-cut');
    expect(branch).toMatchObject({ kind: 'shortcut', marked: true, declared: true });
    expect(branch?.sign).toMatch(/^PARK CUT/);
  });

  it('places every sign and billboard in a slot, off the road, and has boost pads and a ramp truck', () => {
    const slots = roads.flatMap((r) => (r.features ?? []).filter((f) => f.kind === 'billboard'));
    // Run W-R: the downtown's own signs and billboards (`dt-` ids) stand on its roads instead
    // (tools/road/sf-downtown.test.ts checks those), and run W-U's Chinatown and North Beach ones
    // (`cn-`, `nb-`) on theirs (tools/road/sf-chinatown-northbeach.test.ts), as do the mural alleys'
    // (`mi-`, tools/road/sf-mission.test.ts) and the waterfront's (`wf-`,
    // tools/road/sf-waterfront.test.ts); every other one is placed here. Run W-U: a junction sign
    // that only makes sense on a real-road network (Russian Hill's Jones Street, as the Keys' and
    // the Pacific Northwest's tracks allow theirs) stands on that network's roads.
    const items = new Set(slots.map((f) => (f as { item?: string }).item));
    const real = realRoadBoardItems();
    expect(real.has('jones-keep-right')).toBe(true);
    const elsewhere = /^(dt|cn|nb|mi|wf)-/;
    for (const s of [...region.signs, ...region.billboards].filter((x) => !elsewhere.test(x.id)))
      expect(items.has(s.id) || real.has(s.id), s.id).toBe(true);
    for (const f of slots) expect(Math.min(Math.abs(f.d0), Math.abs(f.d1)), f.id).toBeGreaterThanOrEqual(5.5);
    const all = roads.flatMap((r) => r.features ?? []);
    expect(all.filter((f) => f.kind === 'boostPad').length).toBeGreaterThanOrEqual(2);
    expect(all.filter((f) => f.kind === 'rampTruck').length).toBeGreaterThanOrEqual(1);
  });
});
