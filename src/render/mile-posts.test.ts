// Mile-marker posts (playtest 4, P4-19: "The real roads do not have the characteristics of the roads in
// question"; the identity study's S3): the Keys' green posts, one every mile along the Overseas Highway,
// each with its own number. A post is a Codex model (`keys-identity#keys_mile_marker`) with a blank
// board; the number is a per-instance seam in text-surfaces.ts (the sign `keys-mile-marker-face` says
// "MILE {n}", the feature says which n), so the words stay pack text and "cut this" reaches every post.
// The rules asked here: a post every 1,609.344 m along the highway with the numbers falling by one;
// the bridge's east end is mile 46.804 (the article "Overseas Highway": "40.011-46.804"); posts stand
// on the highway's right and not on the old road; each faces the rider coming up to it; each paints its
// own number; and one cut hides them all.
import { Matrix4, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, type TextSurface } from './models';
import { readAsset } from './model-files.test-util';
import type { BoardCatalog } from './boards';
import {
  placeSurface,
  styleOfSurface,
  TextSurfaceLayer,
  type Cell,
  type PlacedSurface,
  type SurfaceContext,
} from './text-surfaces';

const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);
const look = createFlatLook();
const MILE_M = 1609.344;

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/florida-keys/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/*.json', {
  eager: true,
  import: 'default',
});
const regionFiles = import.meta.glob<{
  signs?: { id: string; text: string; tags?: string[]; status?: string }[];
}>('../../packs/base/regions/florida-keys/region.json', { eager: true, import: 'default' });

function sevenMile() {
  const network = Object.values(networkFiles).find((n) => n.id === 'osm-keys-seven-mile');
  if (!network) throw new Error('no osm-keys-seven-mile network');
  const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
  return createRoadNetwork({ network, roads });
}

/**
 * The highway's roads in order, as the route runs them (the Seven Mile's `us1` line), and the connector a
 * rider passes through at the end of a road that has a junction there (the old road's leave and join).
 */
const HIGHWAY = [
  'osm-sm-knights-key',
  'osm-sm-bridge-east',
  'osm-sm-bridge',
  'osm-sm-bridge-west',
  'osm-sm-little-duck-key',
] as const;
const THROUGH: Readonly<Record<string, string>> = {
  'osm-sm-bridge-east': 'osm-keys-seven-mile-old-road-leave',
  'osm-sm-bridge': 'osm-keys-seven-mile-old-road-join',
};

const kit = bakeLandmarkKit('keys-identity', readGlb(await readAsset('models/scenery/keys-identity', 'glb')));

function posts() {
  const road = sevenMile();
  const start: Record<string, number> = {};
  let run = 0;
  for (const id of HIGHWAY) {
    const e = road.edges.find((x) => x.id === id);
    if (!e) throw new Error(`no road ${id}`);
    start[id] = run;
    run += e.length;
    const through = THROUGH[id];
    if (through) run += road.edges.find((x) => x.id === through)?.length ?? NaN;
  }
  const placed = landmarkPlacements(road)
    .filter((p) => p.node === 'keys_mile_marker')
    .map((p) => {
      const id = road.edges[p.edge]?.id ?? '';
      return { ...p, id, station: (start[id] ?? NaN) + (p.feature.s0 + p.feature.s1) / 2 };
    })
    .sort((a, b) => a.station - b.station);
  return { road, placed, start, length: run };
}

describe('mile posts along the Overseas Highway', () => {
  const { road, placed, start } = posts();

  it('stand a mile apart, the numbers falling by one, and the bridge starts at mile 46.804', () => {
    expect(placed.length, 'the Seven Mile has a post at every whole mile on it').toBeGreaterThanOrEqual(7);
    const numbers = placed.map((p) => p.params.number);
    expect(numbers.every((n): n is number => n !== null)).toBe(true);
    for (let i = 1; i < placed.length; i++) {
      const a = placed[i - 1];
      const b = placed[i];
      if (!a || !b) continue;
      expect((a.params.number ?? NaN) - (b.params.number ?? NaN), `post ${i}: one mile number lower`).toBe(1);
      expect(Math.abs(b.station - a.station - MILE_M), `post ${i}: a mile along the road`).toBeLessThan(1.5);
    }
    // The bridge's east end is mile 46.804, so mile 46 stands 0.804 of a mile into the bridge.
    const m46 = placed.find((p) => p.params.number === 46);
    expect(m46, 'mile 46').toBeDefined();
    const intoBridge = (m46?.station ?? NaN) - (start['osm-sm-bridge-east'] ?? NaN);
    print(
      `${placed.length} posts, miles ${numbers[0]} to ${numbers[numbers.length - 1]}; mile 46 stands ${intoBridge.toFixed(1)} m into the bridge (0.804 mi = ${(0.804 * MILE_M).toFixed(1)} m)`,
    );
    expect(Math.abs(intoBridge - 0.804 * MILE_M)).toBeLessThan(2);
  });

  it('stand on the highway`s right, beside the rail, and none on the old road', () => {
    for (const p of placed) {
      expect(p.feature.d0 + p.feature.d1, `mile ${p.params.number}: the rider`).toBeGreaterThan(0);
      expect(HIGHWAY as readonly string[]).toContain(p.id);
    }
    // No post stands on any road of the old line.
    for (const e of road.edges)
      if (e.id.startsWith('osm-sm-old'))
        expect(
          road.featuresOf(e.index, 'landmark').filter((f) => f.id.startsWith('mile-')),
          e.id,
        ).toHaveLength(0);
    expect(placed.some((p) => p.id.startsWith('osm-sm-old'))).toBe(false);
  });

  it('are drawn in the landmark layer, each facing the rider who comes up to it', () => {
    expect(landmarkKitsFor(road)).toContain('keys-identity');
    const layer = new LandmarkLayer(new Map([['keys-identity', kit]]), look, { road });
    const surfaces = layer.surfaces();
    expect(surfaces).toHaveLength(placed.length);
    for (const s of surfaces) {
      // The board's front points back along the road, against the rider's travel.
      const near = placed.reduce((best, p) =>
        Math.hypot(p.x - s.centre.x, p.z - s.centre.z) < Math.hypot(best.x - s.centre.x, best.z - s.centre.z)
          ? p
          : best,
      );
      const f = road.frameAt(near.edge, (near.feature.s0 + near.feature.s1) / 2);
      const against = -(s.normal.x * f.tx + s.normal.z * f.tz);
      expect(against, `mile ${s.number}: the face looks back at the rider`).toBeGreaterThan(0.95);
      expect(s.number, 'carries its number').not.toBeUndefined();
    }
    layer.dispose();
  });
});

/** A 2D context that records the words it paints. */
function recorder() {
  const words: string[] = [];
  const ctx: SurfaceContext = {
    font: '',
    fillStyle: '',
    shadowColor: '',
    shadowBlur: 0,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    fillRect() {},
    fillText(text) {
      words.push(text);
    },
    measureText(text) {
      return { width: text.length * Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 0) * 0.72 };
    },
  };
  return { ctx, words };
}

describe('the number seam of the text surfaces', () => {
  const face = kit.nodes.get('keys_mile_marker')?.surfaces[0] as TextSurface;
  const REF = 'base:region/florida-keys#keys-mile-marker-face';
  const catalog = (text: string): BoardCatalog => ({
    items: { 'keys-mile-marker-face': { ref: REF, text, kind: 'sign' } },
  });
  const at = (n: number | undefined, x: number): PlacedSurface => {
    const s = placeSurface(face, new Matrix4().makeTranslation(x, 0, 0));
    if (n !== undefined) s.number = n;
    return s;
  };
  const make = (surfaces: PlacedSurface[], text: string) => {
    const rec = recorder();
    const layer = new TextSurfaceLayer(look, surfaces, {
      catalog: catalog(text),
      createCanvas: () => ({ ctx: rec.ctx, texture: { dispose() {} } as never }),
    });
    return { layer, rec };
  };

  it('the kit has a mile post with one blank board, and no word on it', () => {
    expect(kit.nodes.has('keys_mile_marker')).toBe(true);
    expect(face.name).toBe('keys_mile_marker_face');
  });

  it('paints each post its own number from one sign, once each', () => {
    const { layer, rec } = make([at(46, 0), at(45, 30), at(44, 60), at(46, 90)], 'MILE {n}');
    // Each distinct number is painted once, as a number board: the small word, then one digit to a row.
    expect([...layer.painted.keys()].sort()).toEqual([
      'keys-mile-marker-face#44',
      'keys-mile-marker-face#45',
      'keys-mile-marker-face#46',
    ]);
    expect(rec.words).toEqual(['MILE', '4', '6', 'MILE', '4', '5', 'MILE', '4', '4']);
    expect(layer.counts().surfaces).toBe(4);
    layer.update(30, 0);
    expect(layer.counts()).toMatchObject({ shown: 4, drawCalls: 1 });
  });

  it('maps each board onto its own narrow cell: no board samples the empty canvas beside its cell', () => {
    const { layer } = make([at(46, 0), at(45, 30)], 'MILE {n}');
    const mesh = layer.group.children[0] as Mesh;
    const uv = mesh.geometry.getAttribute('uv');
    const cell = layer.painted.get('keys-mile-marker-face#46')?.cell as Cell;
    let umax = 0;
    for (let i = 0; i < uv.count; i++) umax = Math.max(umax, uv.getX(i));
    // The canvas is 1024 wide and the cell is as wide as the board is to its height: the boards' u stops there.
    expect(cell.w).toBeLessThan(1024);
    expect(umax).toBeCloseTo(cell.w / 1024, 3);
    layer.dispose();
  });

  it('one cut of the sign blanks every post, and a post with no number shows the sign as written', () => {
    const { layer } = make([at(46, 0), at(45, 30)], 'MILE {n}');
    layer.update(0, 0);
    layer.hide([REF]);
    layer.update(0, 0);
    expect(layer.counts()).toMatchObject({ shown: 0, cut: 2 });
    const { rec } = make([at(undefined, 0)], 'MILE {n}');
    expect(rec.words).toEqual(['MILE {n}']);
    const plain = make([at(46, 0)], 'MILEPOST');
    expect(plain.rec.words).toEqual(['MILEPOST']);
  });

  it('keeps the words in the pack: the Keys region has the sign, live, as a site surface', () => {
    const signs = Object.values(regionFiles)[0]?.signs ?? [];
    const sign = signs.find((x) => x.id === 'keys-mile-marker-face');
    expect(sign, 'keys-mile-marker-face').toBeDefined();
    expect(sign?.text).toContain('{n}');
    expect(sign?.status ?? 'live').toBe('live');
    expect(sign?.tags).toEqual(expect.arrayContaining(['site', 'surface']));
  });
});

// Playtest 4, run B's live check (the maintainer's punch item 1): "the Seven Mile Bridge's mile posts do not
// read from the race's direction. A zoomed frame 28 m before mile 41 shows only a dark stub at the rail". The
// board already stands the right way round (the layer test above), so what the rider saw was a board painted
// in the default dark chalk colour, 0.4 by 0.7 m, 36 m off: a few pixels of dark grey on a phone. What is
// asked: the board looks back up the road at the rider on EVERY Keys road that has posts, going the way the
// race goes (the routes' own order, not an assumption); and its paint is green with a light number. What the
// chase camera shows of the board, in pixels, is `tests/sim/keys-readability.test.ts`'s.
const routeFiles = import.meta.glob<{
  network: string;
  mainPath: string[];
  start: { road: string; dir: number };
}>('../../packs/base/regions/florida-keys/routes/*.json', { eager: true, import: 'default' });

/** Relative luminance of a `#rrggbb` colour (WCAG). */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
};
const isMilePost = (f: { params?: Readonly<Record<string, unknown>> | undefined }): boolean =>
  typeof f.params?.['model'] === 'string' && f.params['model'].endsWith('#keys_mile_marker');

describe('the mile posts read from the race`s direction (run B live check, punch item 1)', () => {
  /** Every Keys network with a post, as built, and its roads. */
  const withPosts = Object.values(networkFiles)
    .filter((n) =>
      Object.values(roadFiles).some((r) => n.roads.includes(r.id) && (r.features ?? []).some(isMilePost)),
    )
    .map((network) => {
      const roads = Object.values(roadFiles).filter((r) => network.roads.includes(r.id));
      return { network, roads, road: createRoadNetwork({ network, roads }) };
    });

  /** The race's direction along a road is +s when a route of its network runs it from its `from` to its `to`. */
  function runsForward(networkId: string, roadId: string, roads: readonly BakedRoad[]): boolean {
    for (const route of Object.values(routeFiles)) {
      if (route.network !== networkId) continue;
      const i = route.mainPath.indexOf(roadId);
      if (i < 0) continue;
      const here = roads.find((r) => r.id === roadId);
      const prev = roads.find((r) => r.id === route.mainPath[i - 1]);
      const next = roads.find((r) => r.id === route.mainPath[i + 1]);
      if (route.start.dir !== 1) return false;
      return (prev ? prev.to === here?.from : true) && (next ? next.from === here?.to : true);
    }
    return false;
  }

  const nearest = (surfaces: ReturnType<LandmarkLayer['surfaces']>, p: { x: number; z: number }) =>
    surfaces.reduce((a, b) =>
      Math.hypot(b.centre.x - p.x, b.centre.z - p.z) < Math.hypot(a.centre.x - p.x, a.centre.z - p.z) ? b : a,
    );

  it('finds the posts on every Keys road that has them, each run from its start to its end by a route', () => {
    expect(withPosts.map((w) => w.network.id)).toContain('osm-keys-seven-mile');
    let n = 0;
    for (const w of withPosts)
      for (const p of landmarkPlacements(w.road).filter((x) => x.node === 'keys_mile_marker')) {
        const id = w.road.edges[p.edge]?.id ?? '';
        expect(runsForward(w.network.id, id, w.roads), `${w.network.id}: a route runs ${id} forward`).toBe(
          true,
        );
        n++;
      }
    print(`${n} posts on ${withPosts.length} network(s), every one on a road a route runs forward`);
    expect(n).toBeGreaterThanOrEqual(7);
  });

  it('every post looks back up the road at the rider who comes to it; a post turned the other way does not (control)', () => {
    let seen = 0;
    for (const w of withPosts) {
      const turned = createRoadNetwork({
        network: w.network,
        roads: w.roads.map((r) => ({
          ...r,
          features: (r.features ?? []).map((f) =>
            isMilePost(f) ? { ...f, params: { ...f.params, yawDeg: 0 } } : f,
          ),
        })),
      });
      for (const [net, backToRider] of [
        [w.road, false],
        [turned, true],
      ] as const) {
        const layer = new LandmarkLayer(new Map([['keys-identity', kit]]), look, { road: net });
        for (const p of landmarkPlacements(net).filter((x) => x.node === 'keys_mile_marker')) {
          const f = net.frameAt(p.edge, (p.feature.s0 + p.feature.s1) / 2);
          const s = nearest(layer.surfaces(), p);
          // The rider's travel is (tx, tz): the face is seen from the front when its normal opposes it.
          const toRider = -(s.normal.x * f.tx + s.normal.z * f.tz);
          if (backToRider) expect(toRider, `mile ${p.params.number} turned round`).toBeLessThan(-0.9);
          else {
            expect(toRider, `mile ${p.params.number}`).toBeGreaterThan(0.95);
            seen++;
          }
        }
        layer.dispose();
      }
    }
    expect(seen).toBeGreaterThanOrEqual(7);
  });

  it('is painted as a green board with a light number, not the default dark chalk', () => {
    const style = styleOfSurface('keys_mile_marker_face');
    const chalk = styleOfSurface('some_other_board');
    const green = (hex: string) => {
      const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return g > r + 30 && g > b + 15;
    };
    print(
      `mile board paint ${style.bg} / ${style.fg}: luminance ${luminance(style.bg).toFixed(3)}, number contrast ${contrast(style.fg, style.bg).toFixed(1)}; the default board ${chalk.bg} luminance ${luminance(chalk.bg).toFixed(3)}`,
    );
    expect(green(style.bg), 'a green board').toBe(true);
    expect(luminance(style.bg), 'not a dark stub').toBeGreaterThanOrEqual(0.09);
    expect(contrast(style.fg, style.bg), 'a number that reads').toBeGreaterThanOrEqual(4.5);
    // Control: the default chalk board is neither green nor light enough, so the measure can fail.
    expect(green(chalk.bg)).toBe(false);
    expect(luminance(chalk.bg)).toBeLessThan(0.09);
  });
});
