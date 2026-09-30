import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { roadNetworkSchema, roadSchema, routeSchema } from '../../src/content/schema';
import {
  compileTrack,
  createRoadNetwork,
  createRouteProgress,
  curvedRoadRates,
  lintRoadNetwork,
  type BakedNetwork,
  type BakedRoad,
  type BakedRoute,
  type RoadPos,
} from '../../src/road';
import { KEYS_M1 } from './tracks/keys-m1';

// The M1 track as baked into the pack (M1 road-1 acceptance): the files are fresh, pass the
// content schemas and the road lint, and the queries behave on the real bends and junctions.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const region = path.join(root, 'packs/base/regions/florida-keys');
const read = (dir: string, id: string): unknown =>
  JSON.parse(readFileSync(path.join(region, dir, `${id}.json`), 'utf8')) as unknown;

const compiled = compileTrack(KEYS_M1);
const network = read('networks', 'keys-m1') as BakedNetwork;
const roads = network.roads.map((id) => read('roads', id) as BakedRoad);
const route = read('routes', 'm1-skeleton-sprint') as BakedRoute;
const net = createRoadNetwork({ network, roads });
const progress = createRouteProgress(net, route);

describe('tools/road: the baked M1 track', () => {
  it('is fresh: the pack files equal a new compile of tools/road/tracks/keys-m1.ts', () => {
    expect(network).toEqual(compiled.network);
    expect(roads).toEqual(compiled.roads);
    expect(route).toEqual(compiled.route);
  });

  it('passes the content schemas and the road lint with no issues', () => {
    expect(roadNetworkSchema.safeParse(network).success).toBe(true);
    for (const r of roads) expect(roadSchema.safeParse(r).success, r.id).toBe(true);
    expect(routeSchema.safeParse(route).success).toBe(true);
    const issues = lintRoadNetwork({ network, roads, routes: [route] });
    expect(issues).toEqual([]);
  });

  it('is about 3.5 km of three roads, joined end to end, with bridge humps', () => {
    console.log(
      `M1 track: ${roads.map((r) => `${r.id} ${r.lengthM.toFixed(1)} m`).join(', ')}; route ${progress.length.toFixed(1)} m`,
    );
    expect(net.edges.length).toBe(3);
    expect(progress.length).toBeGreaterThan(3300);
    expect(progress.length).toBeLessThan(3800);
    expect(progress.distanceToFinish(progress.start.edge, progress.start.s)).toBeCloseTo(progress.length, 6);
    const ys = roads.flatMap((r) => r.samples.data['y'] ?? []);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(6); // exaggerated humps
    // Real bends both ways: tighter than 300 m radius somewhere, each way.
    const ks = roads.flatMap((r) => r.samples.data['kappa'] ?? []);
    expect(Math.max(...ks)).toBeGreaterThan(1 / 300);
    expect(Math.min(...ks)).toBeLessThan(-1 / 300);
  });

  it('has three or four roadside zones, a cop spawn, a start grid, a finish and checkpoints', () => {
    const all = net.edges.flatMap((e) => e.features);
    const zones = all.filter((f) => f.kind === 'roadsideZone').length;
    expect(zones).toBeGreaterThanOrEqual(3);
    expect(zones).toBeLessThanOrEqual(4);
    expect(all.filter((f) => f.kind === 'copSpawn').length).toBe(1);
    expect(progress.startGrid).not.toBeNull();
    expect(progress.checkpoints.length).toBeGreaterThanOrEqual(1);
    for (const c of progress.checkpoints) {
      expect(c.progress).toBeGreaterThan(0);
      expect(c.progress).toBeLessThan(progress.length);
    }
    // The grid fits behind the start line.
    const g = progress.startGrid;
    expect(route.start.s - (g ? (g.rows - 1) * g.rowGapM : 0)).toBeGreaterThanOrEqual(0);
    // The bridge has rails both sides.
    expect(net.barrierAt(1, 500, 'left')?.kind).toBe('rail');
    expect(net.barrierAt(1, 500, 'right')?.kind).toBe('rail');
  });

  it('round-trips toWorld and project within 1 cm on its straights and bends', () => {
    let checked = 0;
    let worst = 0;
    for (const e of net.edges) {
      for (let s = 5; s < e.length - 5; s += 37) {
        for (const d of [-4.5, -1.7, 0, 1.7, 4.5]) {
          const w = net.toWorld(e.index, s, d, 0);
          const p = net.project(w.x, w.z, e.index);
          expect(p.edge).toBe(e.index);
          worst = Math.max(worst, Math.abs(p.s - s), Math.abs(p.d - d));
          checked++;
        }
      }
    }
    console.log(`round trip: ${checked} points, worst error ${(worst * 1000).toFixed(2)} mm`);
    expect(checked).toBeGreaterThan(400);
    expect(worst).toBeLessThan(0.01);
  });

  it('gives a right-hand bend positive kappa, and the kappa sign always follows the turn', () => {
    let checked = 0;
    for (const e of net.edges) {
      for (let s = 10; s < e.length - 10; s += 10) {
        const k = net.kappaAt(e.index, s);
        if (Math.abs(k) < 1e-3) continue;
        const a = net.frameAt(e.index, s - 5);
        const b = net.frameAt(e.index, s + 5);
        // Seen from above (x east, z south), a right turn rotates the tangent clockwise toward +d.
        const turn = a.tx * b.tz - a.tz * b.tx;
        expect(Math.sign(turn), `${e.id} s ${s}`).toBe(Math.sign(k));
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('never launches a grounded bike at top speed: crest curvature × v² stays below g', () => {
    const top = 38; // the M1 bike's 85 mph
    for (const r of roads) {
      const y = r.samples.data['y'] ?? [];
      const h = r.sampleSpacingM;
      for (let i = 2; i < y.length - 2; i++) {
        // Second difference over 4 m, which smooths the 0.1 mm rounding.
        const curv = ((y[i + 2] ?? 0) - 2 * (y[i] ?? 0) + (y[i - 2] ?? 0)) / (4 * h * h);
        expect(-curv * top * top, `${r.id} sample ${i}`).toBeLessThan(9.81 * 0.8);
      }
    }
  });

  it('keeps world distance for movers inside and outside a real bend (the 1 − kappa·d rule)', () => {
    // The tightest right bend on the track.
    let at = { edge: 0, s: 0, k: 0 };
    for (const e of net.edges)
      for (let s = 50; s < e.length - 150; s += 2) {
        const k = net.kappaAt(e.index, s);
        if (k > at.k) at = { edge: e.index, s: s - 60, k };
      }
    const walk = (d: number) => {
      const pos: RoadPos = { edge: at.edge, s: at.s, d, dir: 1 };
      let world = 0;
      let prev = net.toWorld(pos.edge, pos.s, d, 0);
      const r = { ds: 0, dd: 0, yawDrift: 0 };
      for (let t = 0; t < 180; t++) {
        curvedRoadRates(net.kappaAt(pos.edge, pos.s), pos.d, 1, 30, 0, r);
        pos.s += r.ds / 60;
        const w = net.toWorld(pos.edge, pos.s, d, 0);
        world += Math.hypot(w.x - prev.x, w.z - prev.z);
        prev = w;
      }
      return { gained: pos.s - at.s, world };
    };
    const inside = walk(1.7);
    const outside = walk(-1.7);
    console.log(
      `bend kappa ${at.k.toFixed(5)}: inside gains ${inside.gained.toFixed(2)} m of s, outside ${outside.gained.toFixed(2)} m; both cover ${inside.world.toFixed(2)} / ${outside.world.toFixed(2)} m`,
    );
    expect(inside.world).toBeCloseTo(90, 0);
    expect(outside.world).toBeCloseTo(90, 0);
    expect(inside.gained).toBeGreaterThan(outside.gained);
  });

  it('carries movers both ways across both junctions with no lost or doubled distance', () => {
    for (const dir of [1, -1] as const) {
      const pos: RoadPos = dir === 1 ? { edge: 0, s: 1100, d: 1.7, dir } : { edge: 2, s: 100, d: -1.7, dir };
      let prev = net.toWorld(pos.edge, pos.s, pos.d, 0);
      const seen = [pos.edge];
      let worst = 0;
      for (let t = 0; t < 2000; t++) {
        pos.s += dir * 1.1;
        expect(net.advance(pos)).toBe('ok');
        if (seen[seen.length - 1] !== pos.edge) seen.push(pos.edge);
        const w = net.toWorld(pos.edge, pos.s, pos.d, 0);
        const expected = 1.1 * (1 - net.kappaAt(pos.edge, pos.s) * pos.d);
        worst = Math.max(worst, Math.abs(Math.hypot(w.x - prev.x, w.y - prev.y, w.z - prev.z) - expected));
        prev = w;
        if (seen.length === 3 && (dir === 1 ? pos.s > 100 : pos.s < 1100)) break;
      }
      expect(seen).toEqual(dir === 1 ? [0, 1, 2] : [2, 1, 0]);
      // 1 cm per step, which covers the sampled positions and grade.
      expect(worst).toBeLessThan(0.01);
    }
  });
});
