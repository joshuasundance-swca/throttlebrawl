// The Keys' flats as the player sees them (playtest 4, run C's fix check, punch item 1: "the Keys flats still read
// as one turquoise: no seagrass or sand patch in 9 frames at Bahia Honda, Spanish Harbor and Seven Mile"; polish
// batch H's check of #635, punch item 1: "faint at golden hour and on Bahia Honda: both a paler and a darker region
// show in 1 of 24 chase frames, golden-hour Bahia shows neither in 4 of 6, and #635's own test claims 84 to 93 %").
// What is asked here is what a rider reads in a frame, and the model of the frame is held to the live frames:
//   - the colour seen (sea-view.test-util.ts `seenSea`): the water's colour times the patch's tint, through the ink
//     water shader's far body and its wave stroke, the scene's haze at the pixel's depth, the film grade and the
//     final pass's vignette. #635's model had the first two as a plain exposure and no vignette; against the sea
//     colours of 12 live frames (polish H's check, build 22291ea, 915 by 412) it was 6.2 delta E off on average and
//     the model now is 0.7, 2.2 at worst (`LIVE_SEA`);
//   - from the chase camera on the phone's screen, with what the land hides taken out, and only the sea within
//     READS_TO_M of the camera: past it the haze has begun and the horizon's ink line is drawn, and in the live
//     frames the sea there was cream or inked, not teal (of the 23,616 px² the model draws between 250 and 450 m in
//     the 12 frames, 2,220 were teal in the live frame, the live check's own water mask);
//   - "shows" is read as the live check read its frames: a darker area and a paler area, of at least MIN_DELTA_E, than
//     the water of the same row of the screen (a row is one depth band, so the haze and the slope of the light cancel),
//     each a connected area of at least MIN_AREA_PX2 screen pixels. "The same row" is its quartiles, not the same
//     water without the patch: #635 held every sample against bare water that is nowhere in the view, so a strip of
//     the sea that was all sand read as a sand patch and its two-tone sea read as 84 to 93 % shown, where the live
//     frames showed none. A row's lighter quarter is its paler reference and its darker quarter its darker one, so
//     a two-tone sea (sand and seagrass) and a three-tone one (bare water between them) both show;
//   - MIN_AREA_PX2 is the live check's 1,000 px², scaled for what the model does not draw. Over the 12 live frames
//     the model's flats within READS_TO_M held 1.96 times the sea the frame did (137,412 px² against 70,200: the
//     trees, the traffic, the riders and the HUD stand in front of the rest), and at 2,600 px² the model shows both
//     in 2 of those 12 frames, as the live frames did (at 2,000 it shows 4).
// Asked of Bahia Honda (with Spanish Harbor) and the Seven Mile, eight seeds, a view every STEP_M along every road,
// at noon, golden hour and dusk, where the flats fill at least MIN_SEA_SHARE of the screen.
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

type Lab = [number, number, number];

/** A colour difference of this (CIE76) is a different colour at a glance: teal against green, teal against aqua. */
const MIN_DELTA_E = 12;
/** ...over this much of the screen at once, connected: the live check's 1,000 px² for what the model does not draw. */
const MIN_AREA_PX2 = 2600;
/** The sea is read to this far (view depth, m); past it the haze (from 220 m) and the horizon's ink line have it. */
const READS_TO_M = 250;
/** A view counts only where the flats fill this much of the screen (a view of sand, road and sky has none to show). */
const MIN_SEA_SHARE = 0.01;
/** A row of the screen is read where the flats hold at least this many samples of it (about 40 px). */
const MIN_ROW_SAMPLES = 7;
/** Of those views, at least this share must show both seagrass and sand. */
const MIN_BOTH = 0.6;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const TIMES = ['noon', 'golden-hour', 'dusk'] as const;
const NETWORKS = ['osm-keys-seven-mile', 'osm-keys-bahia-honda'];
const STEP_M = 250;
/** The sea's depth (0 the flats, 1 the channel; open water far from land reaches 0.4) from which it is open water. */
const OPEN_DEPTH = 0.3;
const SCREEN_PX2 = PHONE.width * PHONE.height;
const GRID = { cols: Math.ceil(PHONE.width / STEP_PX), rows: Math.ceil(PHONE.height / STEP_PX) };

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

/** The seen colour (CIE L*a*b*) of every flats sample of a view that the rider reads, with its place on the grid. */
function seenFlats(frame: SeaFrame, time: string): { col: number; row: number; lab: Lab }[] {
  return frame.pixels
    .filter((p) => p.deep < 0.1 && p.depthM <= READS_TO_M)
    .map((p) => ({
      col: p.col,
      row: p.row,
      lab: lab(
        seenSea(p.tint, p.depthM, time, { u: (p.col + 0.5) / frame.cols, v: 1 - (p.row + 0.5) / frame.rows }),
      ),
    }));
}

/** What one view shows of the flats: the largest darker and the largest paler area, px², or null for none to show. */
function showsOf(frame: SeaFrame, time: string): { dark: number; pale: number } | null {
  const flats = seenFlats(frame, time);
  if ((flats.length * STEP_PX * STEP_PX) / SCREEN_PX2 < MIN_SEA_SHARE) return null;
  const byRow = new Map<number, typeof flats>();
  for (const p of flats) byRow.set(p.row, [...(byRow.get(p.row) ?? []), p]);
  const dark = new Set<number>();
  const pale = new Set<number>();
  for (const [row, samples] of byRow) {
    if (samples.length < MIN_ROW_SAMPLES) continue;
    const byLight = [...samples].sort((p, q) => p.lab[0] - q.lab[0]);
    const lo = byLight[byLight.length >> 2]?.lab ?? [0, 0, 0];
    const hi = byLight[(byLight.length * 3) >> 2]?.lab ?? [0, 0, 0];
    for (const p of samples) {
      if (p.lab[0] < hi[0] && deltaE(p.lab, hi) >= MIN_DELTA_E) dark.add(row * frame.cols + p.col);
      if (p.lab[0] > lo[0] && deltaE(p.lab, lo) >= MIN_DELTA_E) pale.add(row * frame.cols + p.col);
    }
  }
  return { dark: largestArea(frame, dark), pale: largestArea(frame, pale) };
}

interface Share {
  views: number;
  both: number;
  share: number;
}

/** The share of the views over a network's flats (all seeds), at each time of day, that show both seagrass and sand. */
function measure(id: string, times: readonly string[] = TIMES): Record<string, Share> {
  const { road, dressing, plan } = track(id);
  const out: Record<string, Share> = {};
  for (const t of times) out[t] = { views: 0, both: 0, share: 0 };
  for (const seed of SEEDS)
    for (const frame of seaFrames(road, dressing, plan, seed, STEP_M))
      for (const time of times) {
        const shows = showsOf(frame, time);
        const r = out[time];
        if (!shows || !r) continue;
        r.views++;
        if (shows.dark >= MIN_AREA_PX2 && shows.pale >= MIN_AREA_PX2) r.both++;
      }
  for (const r of Object.values(out)) r.share = r.views > 0 ? r.both / r.views : 0;
  return out;
}

const percent = (r: Share | undefined) =>
  `${((r?.share ?? 0) * 100).toFixed(0)} % (${r?.both} of ${r?.views})`;

/**
 * The sea colours of 12 live frames (polish H's check, the live link at build 22291ea, Bahia Honda run, golden hour
 * seed 3 and noon seed 4, a 915 by 412 touch viewport): where the live frame's sea stood inside a 3 by 3 block of
 * the grid of one tint (a patch's middle, or the deep channel), 36 px from 49 to 151 m (the deck's channel: 63 and
 * 74 m) from the camera, the median colour of the block's teal pixels, against the tint the model's sea mesh held
 * there (`col` and `row` are the block on the grid; the tints are the shipped `sand`, `seagrass` and the channel's).
 */
const LIVE_SEA: readonly {
  time: string;
  tint: readonly [number, number, number];
  depthM: number;
  col: number;
  row: number;
  live: string;
}[] = [
  { time: 'golden-hour', tint: [0.45, 0.5, 0.4], depthM: 49.3, col: 19, row: 30, live: '#1a695e' },
  { time: 'golden-hour', tint: [0.45, 0.5, 0.4], depthM: 68.9, col: 14, row: 37, live: '#19665b' },
  { time: 'golden-hour', tint: [6, 1.6, 1.25], depthM: 75.2, col: 135, row: 34, live: '#48b29d' },
  { time: 'golden-hour', tint: [0.45, 0.5, 0.4], depthM: 151.2, col: 1, row: 33, live: '#1b5c52' },
  { time: 'golden-hour', tint: [0.45, 0.5, 0.4], depthM: 56.3, col: 150, row: 34, live: '#186054' },
  { time: 'golden-hour', tint: [0.8253, 0.27, 0.7986], depthM: 63.5, col: 101, row: 42, live: '#254e93' },
  { time: 'noon', tint: [5.9877, 1.5985, 1.2494], depthM: 48, col: 1, row: 33, live: '#46a993' },
  { time: 'noon', tint: [0.45, 0.5, 0.4], depthM: 48.3, col: 139, row: 37, live: '#19695c' },
  { time: 'noon', tint: [0.45, 0.5, 0.4], depthM: 53.2, col: 4, row: 37, live: '#176356' },
  { time: 'noon', tint: [0.45, 0.5, 0.4], depthM: 108.6, col: 3, row: 40, live: '#196457' },
  { time: 'noon', tint: [6, 1.6, 1.25], depthM: 51.8, col: 147, row: 34, live: '#46ab95' },
  { time: 'noon', tint: [0.826, 0.2727, 0.7993], depthM: 73.9, col: 143, row: 43, live: '#224987' },
];

/** The colour difference between a model sea colour and a live one, for each of LIVE_SEA. */
function liveErrors(plain: boolean): number[] {
  return LIVE_SEA.map((s) => {
    const at = { u: (s.col + 0.5) / GRID.cols, v: 1 - (s.row + 0.5) / GRID.rows };
    const model = seenSea(s.tint, s.depthM, s.time, at, plain);
    const live = [1, 3, 5].map((k) => parseInt(s.live.slice(k, k + 2), 16) / 255) as Lab;
    return deltaE(lab(model), lab(live));
  });
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

  it('is the colour of the live frames: 12 sea colours seen on the live link are each within 3 delta E, 1.5 on average', () => {
    const errors = liveErrors(false);
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    print(
      `the model against 12 live sea colours: mean ${mean.toFixed(2)} delta E, worst ${Math.max(...errors).toFixed(2)}; #635's model: mean ${(liveErrors(true).reduce((a, b) => a + b, 0) / errors.length).toFixed(2)}`,
    );
    for (const [i, e] of errors.entries())
      expect(e, `${LIVE_SEA[i]?.time} ${LIVE_SEA[i]?.live}`).toBeLessThan(3);
    expect(mean).toBeLessThan(1.5);
  });

  it('the measure can tell: #635`s model (a plain exposure, no wave stroke, no vignette) is over 4.5 delta E off on average (control)', () => {
    const errors = liveErrors(true);
    expect(errors.reduce((a, b) => a + b, 0) / errors.length).toBeGreaterThan(4.5);
  });

  it('golden hour is lit as noon is: a patch differs from the bare water by the same delta E (the light is not what made it faint)', () => {
    const diff = (time: string, tint: readonly [number, number, number]) =>
      deltaE(
        lab(seenSea(tint, 100, time, { u: 0.2, v: 0.55 })),
        lab(seenSea([1, 1, 1], 100, time, { u: 0.2, v: 0.55 })),
      );
    for (const tint of [SEA_BANDS.sand, SEA_BANDS.seagrass])
      expect(Math.abs(diff('golden-hour', tint) - diff('noon', tint))).toBeLessThan(1.5);
  });
});

/** The hue (degrees) and chroma of a colour. */
function hueChroma(c: Lab): { hue: number; chroma: number } {
  return { hue: ((Math.atan2(c[2], c[1]) * 180) / Math.PI + 360) % 360, chroma: Math.hypot(c[1], c[2]) };
}

/**
 * Whether the patches stay a sea's colours (the brief's bar for the fix: "without turning noon garish"): at every time
 * of day and at 60 and 150 m, a patch is within MAX_PATCH_DELTA_E of the bare water, its hue stays between teal and
 * green (the bare water is 200 degrees, the patches 176 to 181), its chroma at or under MAX_CHROMA, the sand no
 * lighter than MAX_SAND_L and the seagrass no darker than MIN_GRASS_L. Returns what breaks it.
 */
const MAX_PATCH_DELTA_E = 24;
const MAX_CHROMA = 40;
const MAX_SAND_L = 75;
const MIN_GRASS_L = 33;
function garish(sand: readonly number[], seagrass: readonly number[]): string[] {
  const broken: string[] = [];
  for (const time of TIMES)
    for (const d of [60, 150]) {
      const at = { u: 0.3, v: 0.55 };
      const bare = lab(seenSea([1, 1, 1], d, time, at));
      for (const [name, tint] of [
        ['sand', sand],
        ['seagrass', seagrass],
      ] as const) {
        const seen = lab(seenSea(tint as [number, number, number], d, time, at));
        const { hue, chroma } = hueChroma(seen);
        const tag = `${name} ${time} ${d} m`;
        if (deltaE(seen, bare) > MAX_PATCH_DELTA_E)
          broken.push(`${tag}: ${deltaE(seen, bare).toFixed(1)} delta E from the water`);
        if (hue < 165 || hue > 195) broken.push(`${tag}: hue ${hue.toFixed(0)}`);
        if (chroma > MAX_CHROMA) broken.push(`${tag}: chroma ${chroma.toFixed(0)}`);
        if (name === 'sand' && seen[0] > MAX_SAND_L) broken.push(`${tag}: lightness ${seen[0].toFixed(0)}`);
        if (name === 'seagrass' && seen[0] < MIN_GRASS_L)
          broken.push(`${tag}: lightness ${seen[0].toFixed(0)}`);
      }
    }
  return broken;
}

describe('the patches stay a sea', () => {
  it('at noon, golden hour and dusk the sand and the seagrass are no further from the water than a patch reads at, and stay teal to green', () => {
    expect(garish(SEA_BANDS.sand, SEA_BANDS.seagrass)).toEqual([]);
  });

  it('the measure can tell: tints twice as bold as these (sand 14, 2.6, 1.7; seagrass 0.2, 0.25, 0.2) break it (control)', () => {
    expect(garish([14, 2.6, 1.7], [0.2, 0.25, 0.2]).length).toBeGreaterThan(0);
  });
});

describe.each(NETWORKS)('the Keys` flats at %s, from the chase camera', (id) => {
  it(`at every time of day at least ${MIN_BOTH * 100} % of the views over the flats show a seagrass patch and a sand patch (${MIN_DELTA_E} delta E from the row, ${MIN_AREA_PX2} px² each)`, () => {
    const r = measure(id);
    print(
      `${id}: ${TIMES.map((t) => `${t} ${percent(r[t])}`).join(', ')} (${SEEDS.length} seeds, every ${STEP_M} m, ${PHONE.width} by ${PHONE.height}, sea to ${READS_TO_M} m)`,
    );
    for (const t of TIMES) {
      expect(r[t]?.views, `${t}: the network has flats to ride over`).toBeGreaterThan(50);
      expect(r[t]?.share, t).toBeGreaterThanOrEqual(MIN_BOTH);
    }
    // The light is not what made it faint: golden hour shows as many views as noon, to a few views.
    expect(Math.abs((r['golden-hour']?.share ?? 0) - (r['noon']?.share ?? 0))).toBeLessThan(0.05);
  });

  it('the measure can tell: with the patches as run C found them (a tint of 1.3 and 0.5, a third of the noise for an edge), no view does (control)', () => {
    // sea-bands.ts as it stood in #616, which run C's fix check found one turquoise on the live link.
    const OLD = {
      patchM: 60,
      octaveWeight: 0.32,
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
      const r = measure(id, ['noon']);
      print(`${id}, patches as run C found them: noon ${percent(r['noon'])}`);
      expect(r['noon']?.views).toBeGreaterThan(50);
      expect(r['noon']?.share).toBeLessThan(MIN_BOTH / 3);
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
