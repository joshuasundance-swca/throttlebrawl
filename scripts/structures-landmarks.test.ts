// The landmarks are a structure plan (road/structures/landmarks.ts; the physical world, the maintainer,
// 2026-10-06: everything a rider can reach is physical at its drawn shape, "landmarks too"). Their placement
// moved from render to road/ unchanged (held to what main drew, src/render/structures.golden.json); render draws
// each landmark where the plan stands it; and each landmark's structures hold what render draws of it: every
// solid drawn point inside them (what lies under a bridge's deck, under the course, aside), every face of
// every structure touched by the drawing. A negative control moves a structure and is found.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { describe, expect, it } from 'vitest';
import { planStructures, STRUCTURE_LAYERS, type RoadNetwork } from '../src/road';
import {
  ANCHORAGE_PLAN,
  PIGEON_KEY_PLAN,
  placeStructures,
  planner as landmarksPlanner,
  SUMMIT_LOT_HALF_ALONG_M,
  SUSPENSION_PLAN,
} from '../src/road/structures/landmarks';
import {
  LANDMARK_KIT_IDS,
  landmarkGround,
  landmarkPlaces,
  parseLandmark,
  type LandmarkPlace,
} from '../src/road/structures/landmark-places';
import { ANCHORAGE } from '../src/render/gg-anchorage';
import { landmarkKitsFor, LandmarkLayer, SUSPENSION } from '../src/render/landmarks';
import { createFlatLook } from '../src/render/look';
import {
  LANDMARK_KITS,
  parseLandmarkModel,
  type LandmarkKit,
  type LandmarkKitId,
} from '../src/render/models';
import { PIGEON_KEY } from '../src/render/pigeon-key';
import { PART_SOURCES } from '../src/render/structure-sources.test-util';
import golden from '../src/render/structures.golden.json';
import {
  eachSurfacePoint,
  Hold,
  landmarkKit,
  NETWORK_IDS,
  print,
  track,
  type DrawnPoint,
  type Solid,
} from '../src/render/structures.test-util';
import { SUMMIT_LOT } from '../src/render/summit-lot';

const look = createFlatLook();
const GOLDEN = golden.landmarks as Readonly<Record<string, string[]>>;
const WITH_LANDMARKS = NETWORK_IDS.filter((id) => landmarkPlaces(track(id).road).length > 0);

function fnv(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('the landmarks stand where main drew them (road/structures/landmark-places.ts)', () => {
  it('knows the kits render knows, and reads every model name as render does', () => {
    expect([...LANDMARK_KIT_IDS]).toEqual([...LANDMARK_KITS]);
    const names = new Set<string>(['', '#', 'golden-gate#', '#node', 'nope#node', 'models/landmarks/x#y']);
    for (const id of NETWORK_IDS)
      for (const e of track(id).road.edges)
        for (const f of e.features) if (typeof f.params?.['model'] === 'string') names.add(f.params['model']);
    for (const n of names) expect(parseLandmark(n), n).toEqual(parseLandmarkModel(n));
    expect(names.size).toBeGreaterThan(25);
  });

  it.each(Object.keys(GOLDEN))('%s: every landmark at its place, turn and scale, and its ground', (id) => {
    const { road } = track(id);
    const want = GOLDEN[id] ?? [];
    const places = landmarkPlaces(road);
    const off: string[] = [];
    places.forEach((p, i) => {
      const [fid, model, x, y, z, yaw, scale] = (want[i] ?? '').split(' ');
      const same =
        fid === p.feature.id &&
        model === `${p.kit}#${p.node}` &&
        Math.abs(Number(x) - p.x) < 1e-5 &&
        Math.abs(Number(y) - p.y) < 1e-5 &&
        Math.abs(Number(z) - p.z) < 1e-5 &&
        Math.abs(Number(yaw) - p.yaw) < 1e-8 &&
        Number(scale) === p.scale;
      if (!same) off.push(`${p.feature.id}: ${p.x} ${p.y} ${p.z} ${p.yaw} vs ${want[i]}`);
    });
    const ground = landmarkGround(road).map((q) => `${q.x.toFixed(6)} ${q.z.toFixed(6)} ${q.r.toFixed(6)}`);
    const groundRow = `ground ${ground.length} ${fnv(ground.join('\n'))}`;
    print(
      `[examined] ${id}: ${places.length} landmarks against main's ${want.length - 1}, ${ground.length} ground discs`,
    );
    expect(places.length).toBe(want.length - 1);
    expect(off).toEqual([]);
    expect(groundRow).toBe(want[want.length - 1]);
  });

  it('a negative control: a landmark turned a degree is found', () => {
    const id = Object.keys(GOLDEN)[0] ?? '';
    const p = landmarkPlaces(track(id).road)[0];
    const [, , , , , yaw] = (GOLDEN[id]?.[0] ?? '').split(' ');
    expect(Math.abs(Number(yaw) - ((p?.yaw ?? 0) + Math.PI / 180))).toBeGreaterThan(1e-8);
  });

  it("follows render's figures: the bridge's, the anchorages', Pigeon Key's and the summit lot's", () => {
    for (const [k, v] of Object.entries(SUSPENSION_PLAN))
      expect(SUSPENSION[k as keyof typeof SUSPENSION], k).toBe(v);
    expect(ANCHORAGE).toMatchObject(ANCHORAGE_PLAN);
    expect(PIGEON_KEY.topY).toBe(PIGEON_KEY_PLAN.topY);
    expect(PIGEON_KEY.buildings).toEqual(PIGEON_KEY_PLAN.buildings);
    expect(SUMMIT_LOT.halfAlongM).toBe(SUMMIT_LOT_HALF_ALONG_M);
  });
});

/** How each source's parts were cut: its column's side sets how finely the drawing is sampled. */
const CELL = new Map(PART_SOURCES.map((s) => [s.id, s.options]));
/** How far a drawn point may lie outside the structures, and a structure's face off the drawing in it, m. */
const NEAR_M = 0.3;
/** A scaled-up landmark (the cruise ship at 1.25, the mile posts at 3) holds its drawing that much more loosely. */
const nearOf = (at: LandmarkPlace) => NEAR_M * Math.max(1, at.scale);

/**
 * Which drawn points of a landmark lie under the course, where the plan has no part: for a node the road runs
 * through or under, what is no higher than its origin (the road's surface at its middle: the parts were measured
 * from 5 cm over it); for the Golden Gate, what lies under the road's surface where the point projects.
 */
function underCourse(road: RoadNetwork, at: LandmarkPlace): (q: DrawnPoint) => boolean {
  if (!at.params.overRoad) return () => false;
  if (at.node !== 'gg_bridge') return (q) => q.y <= at.y + 0.05 * at.scale;
  let top = -Infinity;
  for (let s = at.feature.s0; s <= at.feature.s1; s += 10)
    top = Math.max(top, road.toWorld(at.edge, s, 0, 0).y);
  return (q) => {
    if (q.y > top + 1) return false;
    const p = road.project(q.x, q.z, at.edge);
    return q.y < road.toWorld(p.edge, p.s, p.d, 0).y + 0.05;
  };
}

/** Each point of a layer's drawing of one placement, about `step` apart over its triangles, to `each`. */
function eachDrawn(
  layer: LandmarkLayer,
  place: number,
  step: number,
  each: (x: number, y: number, z: number) => void,
): void {
  const { positions, runs } = layer.nearDrawing();
  const glow = layer.glowPositions();
  for (const r of runs) {
    if (r.place !== place) continue;
    const src = r.v0 < 0 ? glow : positions;
    const v0 = r.v0 < 0 ? -1 - r.v0 : r.v0;
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new Float32BufferAttribute(
        Float32Array.from({ length: r.n * 3 }, (_, i) => src[v0 * 3 + i] ?? 0),
        3,
      ),
    );
    eachSurfacePoint(g, step, each);
  }
}

/** A placement's structures held to its drawing: the drawing under the course aside. */
function holdPlace(
  road: RoadNetwork,
  layer: LandmarkLayer,
  place: number,
  at: LandmarkPlace,
  solids: readonly Solid[],
  tol: number,
  slack: number,
) {
  const hold = new Hold(solids, tol, slack);
  const under = underCourse(road, at);
  let points = 0;
  eachDrawn(layer, place, stepOf(road, at), (x, y, z) => {
    if (under({ x, y, z })) return;
    points++;
    hold.add(x, y, z);
  });
  return { points, ...hold.result() };
}

/** The sampling a placement's parts were measured at, in the world: a third of its finest column's side. */
function stepOf(road: RoadNetwork, at: LandmarkPlace): number {
  // The Golden Gate (two towers 230 m tall, 2.6 km of cables) at a metre: its parts hold it to that too.
  if (at.node === 'gg_bridge') return 1;
  const cells = placeStructures(road, at).map((s) => (CELL.get(s.rule)?.cell ?? 1.5) * at.scale);
  return Math.min(...cells) / 3;
}

async function kitsFor(road: RoadNetwork): Promise<Map<LandmarkKitId, LandmarkKit>> {
  const kits = new Map<LandmarkKitId, LandmarkKit>();
  for (const id of landmarkKitsFor(road)) kits.set(id, await landmarkKit(id));
  return kits;
}

describe('render draws each landmark where the plan stands it, and the plan is the drawing', () => {
  it.each(WITH_LANDMARKS)(
    '%s: every solid drawn point inside its structures, each structure touched',
    async (id) => {
      const { road } = track(id);
      const layer = new LandmarkLayer(await kitsFor(road), look, { road });
      const places = landmarkPlaces(road);
      let points = 0;
      let structures = 0;
      let worst = 0;
      const bad: string[] = [];
      places.forEach((at, i) => {
        const specs = placeStructures(road, at);
        const solids: Solid[] = specs.map((s) => {
          const o = CELL.get(s.rule);
          return { foot: s.foot, baseY: s.baseY, roof: s.roof, name: s.rule, freeBase: o?.mode === 'ground' };
        });
        // The drawing sampled as finely as the parts were measured from it; a face comes within the tolerance of
        // the drawing, or within half the sampling step past it.
        const held = holdPlace(
          road,
          layer,
          i,
          at,
          solids,
          nearOf(at),
          Math.max(nearOf(at), stepOf(road, at) / 2 + 0.1),
        );
        points += held.points;
        structures += specs.length;
        worst = Math.max(worst, held.worst);
        if (held.points === 0) bad.push(`${at.kit}#${at.node} (${at.feature.id}): render drew nothing of it`);
        else if (held.looseCount || held.slack.length)
          bad.push(
            `${at.kit}#${at.node} (${at.feature.id}): ${held.looseCount} loose (worst ${held.worst.toFixed(2)}), slack ${held.slack
              .slice(0, 3)
              .map((x) => `${x[0]} ${x[1]} ${x[2].toFixed(2)}`)
              .join(', ')}`,
          );
      });
      print(
        `[examined] ${id}: ${places.length} landmarks, ${structures} structures against ${points} drawn points; the farthest ${worst.toFixed(2)} m outside; ${bad.length} off`,
      );
      expect(points).toBeGreaterThan(0);
      for (const line of bad) print(`  off: ${line}`);
      expect(bad).toEqual([]);
      layer.dispose();
    },
    240_000,
  );

  it('a negative control: a structure moved a metre off its landmark is found', async () => {
    const { road } = track('osm-sf-golden-gate');
    const layer = new LandmarkLayer(await kitsFor(road), look, { road });
    const places = landmarkPlaces(road);
    const i = places.findIndex((p) => p.node === 'toll_gantry');
    const at = places[i];
    if (!at) throw new Error('no toll gantry');
    const specs = placeStructures(road, at);
    const solids = (shift: number): Solid[] =>
      specs.map((s, k) => ({
        foot: { ...s.foot, x: s.foot.x + (k === 0 ? shift : 0) },
        baseY: s.baseY,
        roof: s.roof,
      }));
    expect(holdPlace(road, layer, i, at, solids(0), NEAR_M, NEAR_M)).toMatchObject({
      looseCount: 0,
      slack: [],
    });
    const moved = holdPlace(road, layer, i, at, solids(1), NEAR_M, NEAR_M);
    expect(moved.looseCount + moved.slack.length).toBeGreaterThan(0);
    layer.dispose();
  }, 120_000);
});

describe("the landmarks layer's plan", () => {
  it.each(WITH_LANDMARKS)(
    '%s: planned once from the road, the same again, every structure checked',
    async (id) => {
      const spec = STRUCTURE_LAYERS['landmarks'];
      expect(spec?.features).toContain('landmark');
      expect(await spec?.load()).toBe(landmarksPlanner);
      const layers = { landmarks: spec! };
      const a = planStructures(track(id).road, 7, { landmarks: landmarksPlanner }, layers);
      const b = planStructures(track(id).road, 99, { landmarks: landmarksPlanner }, layers);
      expect(a.items.length).toBeGreaterThan(0);
      // The seed moves nothing of a landmark: two seeds on two fresh networks plan the same structures.
      expect(b.items.map((s) => [s.rule, s.foot, s.baseY, s.roof])).toEqual(
        a.items.map((s) => [s.rule, s.foot, s.baseY, s.roof]),
      );
    },
  );
});
