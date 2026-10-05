// The backdrop (W-P "fill the world", the maintainer, 2026-10-01b: "distance and skyline: hills,
// mountains, city skylines, water, bridges on the horizon"; "unique regional flavor everywhere").
// The checks read the real pack data and the real road networks, build each network's backdrop and
// look at what was built: every network has one, each region's signature pieces are there, the
// race's seed varies only what should vary, and the squeezed depth stays inside the camera's far
// plane. That nothing stands on a road, and every floor lies under the sea as drawn, is checked on
// every route's network by the geometry sweep (tests/sim/geometry-backdrop.test.ts).
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../road';
import { CAMERA_FAR_M } from '../index';
import {
  BACKDROP_FAR_M,
  buildSoup,
  floorDrawnDepth,
  GLIDE_FADE,
  motionAt,
  roadPointsOf,
  squeezedDepth,
  triangulate,
} from './builder';
import {
  backdropProblems,
  CLOUD_STYLES,
  type BackdropNetworkFile,
  type BackdropRegionFile,
  type CloudsPiece,
  type PieceKind,
} from './data';
import { geoFrame } from './geo';
import { backdropFilesFor } from './index';
import { buildClouds, type ShapeCtx } from './shapes';
import { Soup, type Rgb } from './soup';

const networkFiles = import.meta.glob<
  BakedNetwork & { region: string; crs: { originLatDeg: number; originLonDeg: number } }
>('../../../packs/*/regions/*/networks/*.json', { eager: true, import: 'default' });
const roadFiles = import.meta.glob<BakedRoad>('../../../packs/*/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});
const backdropNetworks = import.meta.glob<BackdropNetworkFile>(
  '../../../packs/*/assets/backdrop/*/networks/*.json',
  {
    eager: true,
    import: 'default',
  },
);
const backdropRegions = import.meta.glob<BackdropRegionFile>(
  '../../../packs/*/assets/backdrop/*/region.json',
  {
    eager: true,
    import: 'default',
  },
);

const NETWORKS = Object.values(networkFiles);
/** The examined lines, printed even when the tests pass. */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[print] ${line}\n`);

function filesFor(id: string): { region: BackdropRegionFile; network: BackdropNetworkFile; folder: string } {
  const key = Object.keys(backdropNetworks).find((k) => k.endsWith(`/networks/${id}.json`));
  if (!key) throw new Error(`no backdrop for ${id}`);
  const regionKey = key.replace(/networks\/[^/]+\.json$/, 'region.json');
  const folder = regionKey.split('/').at(-2)!;
  return { network: backdropNetworks[key]!, region: backdropRegions[regionKey]!, folder };
}

function roadPoints(id: string) {
  const network = NETWORKS.find((n) => n.id === id)!;
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return roadPointsOf(createRoadNetwork({ network, roads }).edges, 1);
}

function build(id: string, seed = 7) {
  const { region, network } = filesFor(id);
  return buildSoup(region, network, roadPoints(id), seed);
}

describe('the backdrop data', () => {
  it('covers every road network, with the network origin and region its road data has', () => {
    expect(NETWORKS.length).toBeGreaterThanOrEqual(8);
    for (const n of NETWORKS) {
      const { network, folder } = filesFor(n.id);
      expect(network.network).toBe(n.id);
      expect(folder, n.id).toBe(n.region);
      expect([network.originLatDeg, network.originLonDeg], n.id).toEqual([
        n.crs.originLatDeg,
        n.crs.originLonDeg,
      ]);
      // The renderer finds the same files by the network id alone (lazy chunks).
      expect(backdropFilesFor(n.id), n.id).not.toBeNull();
    }
    expect(backdropFilesFor('no-such-network')).toBeNull();
  });

  it('is well formed, file by file', () => {
    const files = [
      ...Object.entries(backdropRegions).map(([k, v]) => [k, backdropProblems(v, 'region')] as const),
      ...Object.entries(backdropNetworks).map(([k, v]) => [k, backdropProblems(v, 'network')] as const),
    ];
    expect(files.length).toBe(3 + NETWORKS.length);
    for (const [k, problems] of files) expect(problems, k).toEqual([]);
    expect(
      backdropProblems(
        { formatVersion: 1, region: 'x', hazeM: 1, floorColour: 'red', pieces: [{ id: 'a', kind: 'moon' }] },
        'region',
      ),
    ).toEqual(expect.arrayContaining(['floorColour must be #rrggbb', 'pieces[0]: unknown kind moon']));
  });
});

describe('the map frame', () => {
  it('matches the bake: the origin is 0, north is -z, east is +x, at about the right scale', () => {
    const f = geoFrame(45.55, -122.2);
    expect(f.toWorld(45.55, -122.2)[0]).toBeCloseTo(0, 6);
    expect(f.toWorld(45.55, -122.2)[1]).toBeCloseTo(0, 6);
    const [, zN] = f.toWorld(45.56, -122.2);
    expect(zN).toBeLessThan(-1100);
    expect(zN).toBeGreaterThan(-1115);
    const [xE] = f.toWorld(45.55, -122.19);
    expect(xE).toBeGreaterThan(775);
    expect(xE).toBeLessThan(785);
  });

  it("puts a real landmark where it is from a real road: Crown Point stands at the gorge route's start", () => {
    // The Columbia River Highway route begins at Crown Point (45.5397 N, 122.2445 W).
    const f = geoFrame(45.55, -122.2);
    const [x, z] = f.toWorld(45.5397, -122.2445);
    const pts = roadPoints('osm-pnw-gorge');
    const nearest = Math.min(...pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    expect(nearest).toBeLessThan(400);
  });
});

/** What each network must show on its horizon (its region's flavour), by kind. */
const SIGNATURES: Record<string, PieceKind[]> = {
  'keys-m1': ['bridge', 'lighthouse', 'islands', 'vessels', 'clouds'],
  'osm-keys-bahia-honda': ['bridge', 'lighthouse', 'islands', 'vessels', 'clouds'],
  'pnw-c1': ['ridge', 'peak', 'vessels', 'floor'],
  'osm-pnw-chuckanut': ['ridge', 'peak', 'vessels', 'floor'],
  'osm-pnw-gorge': ['ridge', 'peak', 'vessels', 'floor'],
  'sf-hills': ['bridge', 'skyline', 'peak', 'mast', 'vessels', 'clouds', 'floor', 'blocks'],
  'osm-sf-russian-hill': ['bridge', 'skyline', 'peak', 'mast', 'vessels', 'clouds', 'floor', 'blocks'],
  'osm-sf-twin-peaks': ['bridge', 'skyline', 'vessels', 'clouds', 'floor', 'blocks'],
};

describe.each(Object.keys(SIGNATURES))('the backdrop of %s', (id) => {
  const { soup, stats } = build(id);

  it("shows its region's signature pieces, cheaply", () => {
    for (const k of SIGNATURES[id]!) expect(stats.kinds[k] ?? 0, k).toBeGreaterThan(0);
    // A few thousand triangles in one draw call (the frame budget is 150k triangles, 120 calls).
    expect(stats.triangles).toBeGreaterThan(1000);
    expect(stats.triangles).toBeLessThan(20000);
    console.log(
      `[print] ${id}: ${stats.triangles} triangles, kinds ${JSON.stringify(stats.kinds)}, skipped ${stats.skipped}`,
    );
  });

  // "Stands nothing on or beside a road" moved to the geometry sweep (tests/sim/geometry-backdrop.test.ts):
  // it runs on every network a route races on, and checks the floors too (under the sea as the vertex
  // shader draws them), where this check skipped them ("floors may pass beneath").

  it('repeats exactly for a seed, and a new seed moves only what varies between races', () => {
    const again = build(id, 7);
    expect(again.soup.pos).toEqual(soup.pos);
    const other = build(id, 8);
    expect(other.soup.pos).not.toEqual(soup.pos);
  });
});

// W-T, pitch 6 "the horizon comes alive": "a middle distance that moves: shrimp boats and a seaplane
// in the Keys; a freight train on the far bank and a ferry crossing in the PNW; fog pouring over the
// SF hills and headlights crawling along the far bridge".
const MOVERS: Record<string, string[]> = {
  'keys-m1': ['shrimp-boats', 'seaplane'],
  'osm-keys-bahia-honda': ['shrimp-boats', 'seaplane'],
  'pnw-c1': ['sound-ferry', 'far-shore-freight'],
  'osm-pnw-chuckanut': ['outbound-ferry'],
  'osm-pnw-gorge': ['river-tug', 'far-bank-freight'],
  'sf-hills': ['golden-gate-bridge', 'bay-bridge-west', 'headlands-pour', 'twin-peaks-pour'],
  'osm-sf-russian-hill': ['golden-gate-bridge', 'bay-bridge-west', 'headlands-pour', 'twin-peaks-pour'],
  'osm-sf-twin-peaks': ['golden-gate-bridge', 'headlands-pour'],
};

/** The vertex indices of a soup whose motion is a one-way glide (a negative speed). */
const glides = (soup: { motion: number[] }) =>
  Array.from({ length: soup.motion.length / 4 }, (_, v) => v).filter((v) => soup.motion[v * 4 + 2]! < 0);

describe('the middle distance moves (W-T)', () => {
  it('glides one way through a round, thins out at both ends of the run, and leaves a swing as it was', () => {
    const period = 200;
    let last = -Infinity;
    for (let t = 0; t < period; t += 1) {
      const { m, fade } = motionAt(t, -1 / period, 0);
      expect(m).toBeGreaterThan(last);
      expect(m).toBeGreaterThanOrEqual(-1);
      expect(m).toBeLessThan(1);
      // Fully seen through the middle of the run; gone at its very ends.
      if (Math.abs(m) <= GLIDE_FADE) expect(fade).toBe(0);
      last = m;
    }
    expect(motionAt(0, -1 / period, 0).fade).toBe(1);
    expect(motionAt(period * 0.999, -1 / period, 0).fade).toBeGreaterThan(0.99);
    // Round again: the next round starts where the first did.
    expect(motionAt(period, -1 / period, 0).m).toBeCloseTo(-1, 9);
    expect(motionAt(3, 0.5, 0.2)).toEqual({ m: Math.sin(3 * 0.5 + 0.2), fade: 0 });
  });

  it.each(Object.keys(MOVERS))('%s: its region moves on the horizon, past every road', (id) => {
    const { stats } = build(id);
    for (const piece of MOVERS[id]!) expect(stats.moving, piece).toContain(piece);
    print(`${id}: moving ${stats.moving.join(', ')}; ${stats.triangles} triangles`);
  });

  it('runs each glide over a real distance at a believable speed, and the pour falls', () => {
    const { soup } = build('osm-sf-russian-hill');
    const gl = glides(soup);
    expect(gl.length).toBeGreaterThan(500);
    // Headlights glow through the haze: a negative extra haze.
    expect(gl.some((v) => soup.info[v * 4]! < 0)).toBe(true);
    // The pour's puffs come down as they slide out.
    expect(gl.some((v) => soup.lift[v]! < -50)).toBe(true);
    for (const v of gl) {
      const run = 2 * Math.hypot(soup.motion[v * 4]!, soup.motion[v * 4 + 1]!);
      const periodS = 1 / -soup.motion[v * 4 + 2]!;
      expect(run).toBeGreaterThan(500);
      // Traffic at 15 m/s, a pour at a few metres a second: nothing streaks.
      expect(run / periodS).toBeLessThan(60);
    }
  });

  it('brings the seaplane down to the water and the train along its bank', () => {
    const keys = build('keys-m1').soup;
    const plane = glides(keys);
    expect(plane.length).toBeGreaterThan(30);
    // From about 240 m down to the water: the keels end the run at the sea.
    const lowest = Math.min(...plane.map((v) => keys.pos[v * 3 + 1]! + keys.lift[v]!));
    expect(lowest).toBeGreaterThan(-1);
    expect(lowest).toBeLessThan(5);
    expect(Math.max(...plane.map((v) => keys.lift[v]!))).toBeLessThan(-100);
    const gorge = build('osm-pnw-gorge').soup;
    const train = glides(gorge);
    expect(train.length).toBeGreaterThan(46 * 20);
    // The train rides level on its track.
    expect(train.every((v) => gorge.lift[v] === 0)).toBe(true);
  });
});

describe('the squeezed depth', () => {
  it('keeps every piece inside the far plane, keeps far behind near, and leaves the near world exact', () => {
    expect(BACKDROP_FAR_M).toBeLessThan(CAMERA_FAR_M);
    for (const fogFar of [480, 700]) {
      let last = 0;
      for (const d of [1, 50, 200, fogFar - 1, fogFar, fogFar + 1, 800, 2000, 10_000, 100_000, 1e6]) {
        const r = squeezedDepth(d, fogFar);
        expect(r).toBeLessThan(BACKDROP_FAR_M + 1e-9);
        expect(r).toBeGreaterThan(last);
        if (d <= fogFar) expect(r).toBe(d);
        last = r;
      }
    }
  });

  it('draws a floor never nearer than it is up to the fog end, inside the far plane, exact across a flat triangle', () => {
    // verify-skyline mustFix 1: a per-vertex squeeze bent a floor kilometres across into a sheet
    // above the near sea. Floors keep their true positions and draw at floorDrawnDepth instead.
    for (const fogFar of [300, 480, 700]) {
      let last = 0;
      for (const z of [0.5, 5, 50, 200, fogFar, 760, 2000, 10_000, 100_000, 1e6]) {
        const r = floorDrawnDepth(z, fogFar);
        expect(r).toBeGreaterThan(last);
        expect(r).toBeLessThan(BACKDROP_FAR_M + 1e-9);
        if (z <= fogFar) expect(r).toBeGreaterThanOrEqual(z - 1e-9);
        last = r;
      }
      expect(floorDrawnDepth(Math.min(fogFar, BACKDROP_FAR_M - 40), fogFar)).toBeCloseTo(
        Math.min(fogFar, BACKDROP_FAR_M - 40),
        9,
      );
      // 1 / drawn is affine in 1 / z, which is what a flat triangle interpolates exactly on screen.
      const u = (z: number) => 1 / z;
      const g = (z: number) => 1 / floorDrawnDepth(z, fogFar);
      const [a, b, m] = [30, 9000, 1 / (0.5 / 30 + 0.5 / 9000)];
      expect(g(m)).toBeCloseTo((g(a) + g(b)) / 2, 12);
      expect(u(m)).toBeCloseTo((u(a) + u(b)) / 2, 12);
    }
  });
});

describe('the floor triangulation', () => {
  const area = (p: readonly (readonly [number, number])[]) =>
    Math.abs(
      p.reduce((s, [x0, z0], i) => s + x0 * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * z0, 0),
    ) / 2;
  const triArea = (p: readonly (readonly [number, number])[], t: number[][]) =>
    t.reduce((s, [a, b, c]) => s + area([p[a!]!, p[b!]!, p[c!]!]), 0);

  it('covers a concave polygon exactly, in either winding', () => {
    // An L shape: 3 x 1 plus 1 x 2.
    const l: [number, number][] = [
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ];
    for (const p of [l, [...l].reverse()]) {
      const t = triangulate(p);
      expect(t.length).toBe(4);
      expect(triArea(p, t)).toBeCloseTo(5, 9);
    }
  });

  it('covers every floor in the packs exactly', () => {
    let checked = 0;
    for (const region of Object.values(backdropRegions))
      for (const p of region.pieces)
        if (p.kind === 'floor') {
          const t = triangulate(p.area);
          expect(t.length, p.id).toBe(p.area.length - 2);
          expect(triArea(p.area, t) / area(p.area), p.id).toBeCloseTo(1, 6);
          checked++;
        }
    expect(checked).toBeGreaterThanOrEqual(5);
  });
});

// Playtest 3's wave C check: "the lone tall cloud on the horizon reads as a mushroom cloud in Duval
// and Seven Mile frames". The rule: no cloud the backdrop draws has a waist (narrower at some height than both
// below and above it: a stalk under a cap), and none is taller than it is wide (a lone tower).
describe('the clouds', () => {
  const LEVELS = 24;

  /**
   * A cloud's silhouette: its width (m, the widest pair of points where its triangles cross the level)
   * at each of LEVELS heights through the middle of its range, and its overall height and width.
   */
  function silhouette(pos: readonly number[]): { widths: number[]; height: number; width: number } {
    const tris: [number, number, number][][] = [];
    for (let i = 0; i < pos.length; i += 9)
      tris.push(
        [0, 3, 6].map((o): [number, number, number] => [pos[i + o]!, pos[i + o + 1]!, pos[i + o + 2]!]),
      );
    const ys = tris.flatMap((t) => t.map((v) => v[1]));
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    const across = (pts: readonly [number, number][]) => {
      let w = 0;
      for (const a of pts) for (const b of pts) w = Math.max(w, Math.hypot(a[0] - b[0], a[1] - b[1]));
      return w;
    };
    const widths = Array.from({ length: LEVELS }, (_, i) => {
      const y = y0 + ((i + 0.5) / LEVELS) * (y1 - y0);
      const pts: [number, number][] = [];
      for (const t of tris)
        for (let e = 0; e < 3; e++) {
          const a = t[e]!;
          const b = t[(e + 1) % 3]!;
          if ((a[1] - y) * (b[1] - y) >= 0) continue;
          const f = (y - a[1]) / (b[1] - a[1]);
          pts.push([a[0] + (b[0] - a[0]) * f, a[2] + (b[2] - a[2]) * f]);
        }
      return across(pts);
    });
    return {
      widths,
      height: y1 - y0,
      width: across(tris.flatMap((t) => t.map((v) => [v[0], v[2]] as [number, number]))),
    };
  }

  /**
   * How deep the silhouette's deepest waist is: a level narrower than the widest level below it AND
   * the widest above it, as a share of the narrower of those two (0 for a heap; a stalk under a cap
   * is well over a third).
   */
  const waist = (w: readonly number[]) =>
    Math.max(
      0,
      ...w.map((x, j) => {
        const lower = Math.max(0, ...w.slice(0, j));
        const upper = Math.max(0, ...w.slice(j + 1));
        const side = Math.min(lower, upper);
        return side > 0 ? 1 - x / side : 0;
      }),
    );

  const cloudOf = (p: CloudsPiece, seed: number) => {
    const soup = new Soup();
    const ctx: ShapeCtx = {
      soup,
      toWorld: (q) => [q[0], q[1]],
      nearRoad: () => false,
      centre: [0, 0],
      seed,
    };
    // One cloud of the piece's own style and size, anywhere on its distance ring.
    const { path: _path, ...rest } = p;
    const one: CloudsPiece = { ...rest, count: 1, distanceM: p.distanceM ?? [9000, 9000] };
    buildClouds(one, ctx);
    return silhouette(soup.pos);
  };

  it('has a negative control: a tower with an anvil has a waist, and is taller than it is wide', () => {
    const soup = new Soup();
    const c: Rgb = [1, 1, 1];
    for (let k = 0; k < 4; k++) soup.blob([0, 700 + k * 900, 0], 900, 900, 900, c, c, 0, 6000, k);
    soup.blob([0, 5200, 0], 3300, 400, 2500, c, c, 0, 6000, 0);
    const m = silhouette(soup.pos);
    expect(waist(m.widths)).toBeGreaterThan(0.3);
    // A heap (a wide puff with a smaller one on it) has none.
    const heap = new Soup();
    heap.blob([0, 600, 0], 2500, 700, 2000, c, c, 0, 2500, 0);
    heap.blob([0, 1300, 0], 1300, 600, 1100, c, c, 0, 2500, 1);
    expect(waist(silhouette(heap.pos).widths)).toBeLessThan(0.1);
  });

  it('draws no waist and no lone tower, in any style the packs use, for any seed', () => {
    const styles = new Set<string>();
    let worst = 0;
    for (const region of Object.values(backdropRegions))
      for (const p of region.pieces)
        // A pour is fog lying on a crest: its own builder, no standing cloud.
        if (p.kind === 'clouds' && p.style !== 'pour') {
          styles.add(p.style);
          for (let seed = 1; seed <= 25; seed++) {
            const m = cloudOf(p, seed);
            worst = Math.max(worst, waist(m.widths));
            expect(waist(m.widths), `${p.id} seed ${seed}: a cap over a stalk`).toBeLessThanOrEqual(0.2);
            expect(m.width / m.height, `${p.id} seed ${seed}: a lone tower`).toBeGreaterThanOrEqual(1.2);
          }
        }
    expect(styles.has('cumulus'), 'the Keys have a heap of cumulus').toBe(true);
    print(`clouds: ${[...styles].join(', ')}; the deepest waist of any ${worst.toFixed(2)}`);
  });

  it('has no style that builds a tower with an anvil: a pack that names one is refused', () => {
    expect(CLOUD_STYLES as readonly string[]).not.toContain('thunderhead');
    const piece = {
      id: 'c',
      kind: 'clouds',
      count: 1,
      distanceM: [9000, 9000],
      baseM: 600,
      topM: [2000, 3000],
    };
    const refused = (style: string) =>
      backdropProblems(
        {
          formatVersion: 1,
          region: 'x',
          hazeM: 1,
          floorColour: '#ffffff',
          pieces: [{ ...piece, colour: '#ffffff', style }],
        },
        'region',
      );
    expect(refused('thunderhead')).toEqual(
      expect.arrayContaining(['pieces[0]: style must be one of cumulus, bank, fog, pour']),
    );
    expect(refused('cumulus')).toEqual([]);
  });
});
