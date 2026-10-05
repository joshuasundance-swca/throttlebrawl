// Mile-marker posts (playtest 4, P4-19: "The real roads do not have the characteristics of the roads in
// question"; the identity study's S3): the Keys' green posts, one every mile along the Overseas Highway,
// each with its own number. A post is a Codex model (`keys-identity#keys_mile_marker`) with a blank
// board; the number is a per-instance seam in text-surfaces.ts (the sign `keys-mile-marker-face` says
// "MILE {n}", the feature says which n), so the words stay pack text and "cut this" reaches every post.
// The rules asked here: a post every 1,609.344 m along the highway with the numbers falling by one;
// the bridge's east end is mile 46.804 (the article "Overseas Highway": "40.011-46.804"); posts stand
// on the highway's right and not on the old road; each faces the rider coming up to it; each paints its
// own number; and one cut hides them all.
import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, type BakedNetwork, type BakedRoad } from '../road';
import { readGlb } from './glb';
import { LandmarkLayer, landmarkKitsFor, landmarkPlacements } from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, type TextSurface } from './models';
import { readAsset } from './model-files.test-util';
import type { BoardCatalog } from './boards';
import { placeSurface, TextSurfaceLayer, type PlacedSurface, type SurfaceContext } from './text-surfaces';

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
    expect(rec.words.slice().sort()).toEqual(['MILE 44', 'MILE 45', 'MILE 46']);
    expect(layer.counts().surfaces).toBe(4);
    layer.update(30, 0);
    expect(layer.counts()).toMatchObject({ shown: 4, drawCalls: 1 });
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
