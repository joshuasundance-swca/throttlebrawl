// The Keys' flats as the player sees them (playtest 4, run C's fix check, punch item 1: "the Keys flats still read
// as one turquoise: no seagrass or sand patch in 9 frames at Bahia Honda, Spanish Harbor and Seven Mile, chase
// and far cameras, golden hour and noon". #616's test counted the views that hold a patch in the mesh's vertex
// colours; it did not ask whether the patch shows). What is asked here is what shows:
//   - the colour the player sees: the water's colour times the patch's tint, through the ink water shader's
//     light, the scene's haze at the pixel's depth and the film grade (sea-view.test-util.ts `seenSea`), against
//     the same pixel of the same water without the patch;
//   - from the chase camera on the phone's screen, with what the land hides taken out (the beaches take most of
//     the near sea; the road scene's triangles are rasterised into a depth buffer);
//   - "shows" is a colour difference (CIE76 delta E) of at least MIN_DELTA_E over a connected area of at least
//     MIN_AREA_PX2 screen pixels, a patch you can see as a shape, in a view with at least MIN_SEA_SHARE of the
//     screen as flats; a view shows seagrass when a darker such area is in it and sand when a paler one is.
// Asked of Bahia Honda (with Spanish Harbor) and the Seven Mile, three seeds, a view every STEP_M along every
// road, at noon, golden hour and dusk. The control is the patches as they were when run C found them.
import { Fog, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../../src/road';
import { createFlatLook } from '../../src/render/look';
import type { RoadDressing } from '../../src/render/road-mesh';
import { SEA_BANDS, seaDepthAt, seaPlanFor, seaTintAt } from '../../src/render/sea-bands';
import {
  deltaE,
  FOG_FAR_M,
  FOG_NEAR_M,
  lab,
  seaFrames,
  seenSea,
  STEP_PX,
  type SeaFrame,
} from './sea-view.test-util';
import { PHONE } from './chase-sight.test-util';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});

function track(id: string) {
  const network = Object.values(networkFiles).find((n) => n.id === id);
  if (!network) throw new Error(`no network ${id}`);
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const road = createRoadNetwork({ network, roads });
  const plan = seaPlanFor(road, (e) => dressing[e.id]?.tags);
  if (!plan) throw new Error(`no sea plan for ${id}`);
  return { road, dressing, plan };
}

/** A colour difference of this (CIE76) is a different colour at a glance: teal against green, teal against aqua. */
const MIN_DELTA_E = 12;
/** ...over this much of the screen at once, connected (about 33 by 33 px, or 100 by 10 px: a band you can see). */
const MIN_AREA_PX2 = 1000;
/** A view counts only where the flats fill this much of the screen (a view of sand, road and sky has none to show). */
const MIN_SEA_SHARE = 0.01;
/** Of those views, at least this share must show both seagrass and sand. */
const MIN_BOTH = 0.6;
const SEEDS = [1, 2, 3];
const TIMES = ['noon', 'golden-hour', 'dusk'] as const;
const NETWORKS = ['osm-keys-seven-mile', 'osm-keys-bahia-honda'];
const STEP_M = 250;
/** The sea's depth (0 the flats, 1 the channel; open water far from land reaches 0.4) from which it is open water. */
const OPEN_DEPTH = 0.3;
const SCREEN_PX2 = PHONE.width * PHONE.height;

/** The area, in screen px², of the largest 4-connected run of samples of the grid that are in `set`. */
function largestArea(frame: SeaFrame, set: ReadonlySet<number>): number {
  const seen = new Set<number>();
  let best = 0;
  for (const start of set) {
    if (seen.has(start)) continue;
    let n = 0;
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const k = stack.pop() as number;
      n++;
      const row = Math.floor(k / frame.cols);
      const col = k % frame.cols;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const r = row + dr;
        const c = col + dc;
        if (r < 0 || c < 0 || r >= frame.rows || c >= frame.cols) continue;
        const next = r * frame.cols + c;
        if (set.has(next) && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    best = Math.max(best, n);
  }
  return best * STEP_PX * STEP_PX;
}

/** What one view shows of the flats: the largest darker and the largest paler area, px², or null for no flats in it. */
function showsOf(frame: SeaFrame, time: string): { dark: number; pale: number } | null {
  const flats = frame.pixels.filter((p) => p.deep < 0.1);
  if ((flats.length * STEP_PX * STEP_PX) / SCREEN_PX2 < MIN_SEA_SHARE) return null;
  const dark = new Set<number>();
  const pale = new Set<number>();
  for (const p of flats) {
    const seen = lab(seenSea(p.tint, p.depthM, time));
    const bare = lab(seenSea([1, 1, 1], p.depthM, time));
    if (deltaE(seen, bare) >= MIN_DELTA_E) (seen[0] < bare[0] ? dark : pale).add(p.row * frame.cols + p.col);
  }
  return { dark: largestArea(frame, dark), pale: largestArea(frame, pale) };
}

/** The share of the views over a network's flats (all seeds and times) that show both seagrass and sand. */
function measure(id: string): { views: number; both: number; share: number; dark: number; pale: number } {
  const { road, dressing, plan } = track(id);
  let views = 0;
  let both = 0;
  let dark = 0;
  let pale = 0;
  for (const seed of SEEDS)
    for (const frame of seaFrames(road, dressing, plan, seed, STEP_M))
      for (const time of TIMES) {
        const r = showsOf(frame, time);
        if (!r) continue;
        views++;
        if (r.dark >= MIN_AREA_PX2) dark++;
        if (r.pale >= MIN_AREA_PX2) pale++;
        if (r.dark >= MIN_AREA_PX2 && r.pale >= MIN_AREA_PX2) both++;
      }
  return { views, both, share: views > 0 ? both / views : 0, dark, pale };
}

describe('the colour the player sees', () => {
  it('uses the scene`s own haze: the fog the look sets up starts and ends where the model says', () => {
    for (const time of TIMES) {
      const scene = new Scene();
      createFlatLook().setupScene(scene, { timeOfDay: time });
      expect(scene.fog).toBeInstanceOf(Fog);
      expect((scene.fog as Fog).near, `${time}: the haze starts`).toBe(FOG_NEAR_M);
      expect((scene.fog as Fog).far, `${time}: the haze is full`).toBe(FOG_FAR_M);
    }
  });

  it('is the water`s colour through the haze: a patch that reads at 60 m is gone at the fog`s end', () => {
    for (const time of TIMES) {
      const bare = (d: number) => lab(seenSea([1, 1, 1], d, time));
      const sand = (d: number) => lab(seenSea(SEA_BANDS.sand, d, time));
      const grass = (d: number) => lab(seenSea(SEA_BANDS.seagrass, d, time));
      expect(deltaE(sand(60), bare(60)), `${time}: sand at 60 m`).toBeGreaterThan(MIN_DELTA_E);
      expect(deltaE(grass(60), bare(60)), `${time}: seagrass at 60 m`).toBeGreaterThan(MIN_DELTA_E);
      expect(sand(60)[0], 'sand is paler').toBeGreaterThan(bare(60)[0]);
      expect(grass(60)[0], 'seagrass is darker').toBeLessThan(bare(60)[0]);
      // The haze closes over everything alike at the fog's end: nothing is left to tell a patch by.
      expect(deltaE(sand(FOG_FAR_M), bare(FOG_FAR_M)), `${time}: sand in the haze`).toBeLessThan(1);
      expect(deltaE(grass(FOG_FAR_M), bare(FOG_FAR_M)), `${time}: seagrass in the haze`).toBeLessThan(1);
      // ...and halfway through the fog (450 m) it has taken a good part of a patch's difference.
      expect(deltaE(grass(450), bare(450))).toBeLessThan(deltaE(grass(60), bare(60)) * 0.7);
    }
  });
});

describe.each(NETWORKS)('the Keys` flats at %s, from the chase camera', (id) => {
  it(`at least ${MIN_BOTH * 100} % of the views over the flats show a seagrass patch and a sand patch (a difference of ${MIN_DELTA_E} delta E over ${MIN_AREA_PX2} px²)`, () => {
    const r = measure(id);
    print(
      `${id}: ${r.both} of ${r.views} views over the flats (${SEEDS.length} seeds, ${TIMES.length} times of day, every ${STEP_M} m, ${PHONE.width} by ${PHONE.height}) show both, ${(r.share * 100).toFixed(0)} %; seagrass in ${r.dark}, sand in ${r.pale}`,
    );
    expect(r.views, 'the network has flats to ride over').toBeGreaterThan(100);
    expect(r.share).toBeGreaterThanOrEqual(MIN_BOTH);
  });

  it('the measure can tell: with the patches as run C found them (a tint of 1.3 and 0.5, a third of the noise for an edge), no view does (control)', () => {
    // sea-bands.ts as it stood in #616, which run C's fix check found one turquoise on the live link.
    const OLD = {
      patchFrom: 0.04,
      patchTo: 0.36,
      patchGiveWay: [0, 0.5],
      sand: [1.3, 1.2, 0.95],
      seagrass: [0.5, 0.72, 0.62],
    };
    const bands = SEA_BANDS as unknown as Record<string, unknown>;
    const kept = Object.fromEntries(Object.keys(OLD).map((k) => [k, bands[k]]));
    Object.assign(bands, OLD);
    try {
      const r = measure(id);
      print(
        `${id}, patches as run C found them: ${r.both} of ${r.views} views show both, ${(r.share * 100).toFixed(0)} %`,
      );
      expect(r.views).toBeGreaterThan(100);
      expect(r.share).toBeLessThan(MIN_BOTH / 3);
    } finally {
      Object.assign(bands, kept);
    }
  });
});

describe('the open sea stays the sea', () => {
  const { road, plan } = track('osm-keys-seven-mile');
  const first = road.edges[0];
  if (!first) throw new Error('no road');
  const origin = road.toWorld(first.index, first.length / 2, 0, 0);
  // A field of points around the Seven Mile, out to 6 km (the sea is wide there).
  const field: { x: number; z: number }[] = [];
  for (let i = -30; i <= 30; i++)
    for (let j = -30; j <= 30; j++) field.push({ x: origin.x + i * 200, z: origin.z + j * 200 });
  const same = (a: readonly number[], b: readonly number[]) =>
    [0, 1, 2].every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 1e-9);

  it('carries no patch where the sea is open water, whatever the seed', () => {
    const open = field.filter((p) => seaDepthAt(plan, p.x, p.z) >= OPEN_DEPTH);
    print(`${open.length} of ${field.length} points are open sea`);
    expect(open.length, 'there is open sea around the bridge').toBeGreaterThan(50);
    for (const p of open)
      expect(same(seaTintAt(plan, p.x, p.z, 1), seaTintAt(plan, p.x, p.z, 2)), `${p.x}, ${p.z}`).toBe(true);
  });

  it('the measure can tell: over the flats the seed lays different patches (control)', () => {
    const flats = field.filter((p) => seaDepthAt(plan, p.x, p.z) < 0.02);
    expect(flats.length, 'there are flats around the bridge').toBeGreaterThan(50);
    const differ = flats.filter((p) => !same(seaTintAt(plan, p.x, p.z, 1), seaTintAt(plan, p.x, p.z, 2)));
    expect(differ.length / flats.length).toBeGreaterThan(0.5);
  });
});
