/// <reference types="vite/client" />
// Bridge bays (playtest 3, T12.3; the maintainer's round 3: the Seven Mile has "real geometry", the
// old bridge beside it, and "the real 80 m missing span is the big jump"): the Seven Mile's two
// spans, its repair platforms and the Moser gap's two ends are dressed with the Codex kit
// (`models/scenery/seven-mile-kit`, CX2), so the old bridge reads as the old bridge and the gap's
// ends match the broken ends road-mesh draws (T11.1).
//
// The planner is checked on fixture roads (a flat deck, a hump, a gap, a kicker), the kit against
// the planner's own numbers (each bay is as long as the plan says), the scene against a code-made
// kit, and the real bake with the real kit. Each rule has a control: the same check on a case that
// should find nothing, so a pass cannot be an empty one.
import {
  Box3,
  BoxGeometry,
  Frustum,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Vector3,
  type BufferGeometry,
} from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import {
  BAY_BLOCK_M,
  BAY_DRAW_M,
  BAY_KINDS,
  BAY_M,
  BAY_ROOT,
  BAY_ROOTS,
  GAP_END_ZONE_M,
  PIER_M,
  STAGING_LEGS,
  isSevenMile,
  planBays,
  type BayEdge,
  type BayKind,
} from './bridge-bays';
import { readGlb } from './glb';
import { createFlatLook } from './look';
import { bakeModel, MODEL_ASSETS, modelKindsFor, type SceneryModel, type SceneryModels } from './models';
import { buildRoadScene, networkTags, type RoadDressing, type RoadScene } from './road-mesh';
import { MergedScenery, SCENERY_BLOCK_M } from './scenery-merge';
import type { ScenerySpot } from './scenery';

const look = createFlatLook();
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;
const print = (line: string) => stdout.write(`[examined] ${line}\n`);

// ---- Fixtures -----------------------------------------------------------------------------------

const KINDS = BAY_ROOTS;
const kindOf = (spot: ScenerySpot): BayKind => {
  const k = BAY_KINDS[spot.variant];
  if (!k) throw new Error(`no bay kind for variant ${spot.variant}`);
  return k;
};
const rootOf = (kind: BayKind): string => BAY_ROOT[kind];

/** A straight road running north (-z) from the origin, its deck at `y(s)`. */
function line(y: (s: number) => number = () => 4): BayEdge['at'] {
  return (s) => ({ x: 0, y: y(s), z: -s });
}

function edgeOf(over: Partial<BayEdge> & { length: number }): BayEdge {
  return {
    edge: 0,
    tags: [{ s0: 0, s1: over.length, side: 'both', tag: 'bridge' }],
    shortcutOnly: false,
    sevenMile: true,
    gaps: [],
    ramps: [],
    at: line(),
    ...over,
  };
}
const withTags = (length: number, ...tags: string[]) =>
  tags.map((tag) => ({ s0: 0, s1: length, side: 'both', tag }));

/** Where a bay's far end stands: its origin plus its length along its heading, and the slope up. */
function farEnd(spot: ScenerySpot, lengthM: number): { x: number; y: number; z: number } {
  return {
    x: spot.p.x + Math.sin(spot.turn) * lengthM,
    y: spot.p.y + (spot.slope ?? 0) * lengthM,
    z: spot.p.z + Math.cos(spot.turn) * lengthM,
  };
}
const dist3 = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const lengthOf = (spot: ScenerySpot): number => BAY_M[kindOf(spot)];

/** The s range one bay covers on a straight north-running fixture (s = -z of its origin). */
const rangeOf = (spot: ScenerySpot): [number, number] => {
  const s0 = -spot.p.z;
  const dir = Math.cos(spot.turn) < 0 ? 1 : -1;
  return dir > 0 ? [s0, s0 + lengthOf(spot)] : [s0 - lengthOf(spot), s0];
};

// ---- The planner --------------------------------------------------------------------------------

describe('where the bays go (the planner)', () => {
  it('lays new-span bays end to end along a bridge, floor(L / b) of them, each abutting the next within 5 cm', () => {
    const L = 41 * 10 + 17;
    const spots = planBays(edgeOf({ length: L }));
    expect(spots.length).toBe(Math.floor(L / BAY_M.newSpan));
    expect(spots.every((s) => s.kind === 'bay')).toBe(true);
    for (let i = 0; i + 1 < spots.length; i++) {
      const gap = dist3(farEnd(spots[i]!, lengthOf(spots[i]!)), spots[i + 1]!.p);
      expect(gap, `bay ${i} to ${i + 1}`).toBeLessThan(0.05);
    }
    // The control: a bridge shorter than one bay gets none, so the count above is not a constant.
    expect(planBays(edgeOf({ length: BAY_M.newSpan - 1 }))).toEqual([]);
    print(
      `${spots.length} bays of ${BAY_M.newSpan} m on ${L} m, worst joint ${Math.max(...spots.slice(1).map((s, i) => dist3(farEnd(spots[i]!, lengthOf(spots[i]!)), s.p))).toFixed(4)} m`,
    );
  });

  it('follows a hump: each bay starts at the road and ends at the road, and its deck stays on the road between', () => {
    const L = 41 * 24;
    // The Moser hump's shape: a 13 m rise over 1 km, as a smooth bump (6.8% at its steepest).
    const hump = (s: number) => 4 + 13 * Math.sin((Math.PI * s) / L) ** 2;
    const at = line(hump);
    const spots = planBays(edgeOf({ length: L, at }));
    let worst = 0;
    for (const sp of spots) {
      const s0 = -sp.p.z;
      expect(Math.abs(sp.p.y - hump(s0)), 'starts on the road').toBeLessThan(0.01);
      const end = farEnd(sp, BAY_M.newSpan);
      expect(Math.abs(end.y - hump(s0 + BAY_M.newSpan)), 'ends on the road').toBeLessThan(0.05);
      const mid = sp.p.y + (sp.slope ?? 0) * (BAY_M.newSpan / 2);
      worst = Math.max(worst, Math.abs(mid - hump(s0 + BAY_M.newSpan / 2)));
    }
    expect(worst).toBeLessThan(0.1);
    // The control: the same bays laid flat (no slope) leave the deck more than a metre off the road
    // somewhere on the hump, so the slope is doing the following.
    let flatWorst = 0;
    for (const sp of spots) {
      const s0 = -sp.p.z;
      flatWorst = Math.max(flatWorst, Math.abs(sp.p.y - hump(s0 + BAY_M.newSpan)));
    }
    expect(flatWorst).toBeGreaterThan(1);
    print(
      `hump: ${spots.length} bays, deck within ${worst.toFixed(3)} m of the road at mid-bay (flat bays: ${flatWorst.toFixed(2)} m off at an end)`,
    );
  });

  it('stands every pier in the water: the tall bay where the deck is high, the short one where it is low', () => {
    const L = 41 * 24;
    const hump = (s: number) => 4 + 13 * Math.sin((Math.PI * s) / L) ** 2;
    const spots = planBays(edgeOf({ length: L, at: line(hump) }));
    const kinds = new Set(spots.map(kindOf));
    // Both bays are used on the hump (the control: a flat low deck uses only the short one).
    expect(kinds).toEqual(new Set(['newSpan', 'newSpanTall']));
    expect(new Set(planBays(edgeOf({ length: L })).map(kindOf))).toEqual(new Set(['newSpan']));
    for (const sp of spots) {
      const low = Math.min(sp.p.y, farEnd(sp, BAY_M.newSpan).y);
      const foot = low - PIER_M[kindOf(sp)];
      expect(foot, `a pier from a deck at ${low.toFixed(1)} m`).toBeLessThanOrEqual(-0.5);
    }
  });

  it('dresses the old bridge with its own bays (arch and girder), and only where the road is tagged old-bridge', () => {
    const L = 24 * 40;
    const old = planBays(edgeOf({ length: L, tags: withTags(L, 'bridge', 'old-bridge') }));
    const kinds = new Set(old.map(kindOf));
    expect(kinds).toEqual(new Set(['oldArch', 'oldGirder']));
    for (let i = 0; i + 1 < old.length; i++) {
      expect(dist3(farEnd(old[i]!, lengthOf(old[i]!)), old[i + 1]!.p)).toBeLessThan(0.05);
    }
    // The spans' own bays never mix: the same bridge without the old tag is the new span's.
    expect(new Set(planBays(edgeOf({ length: L })).map(kindOf))).toEqual(new Set(['newSpan']));
    // Half old, half new on one road: each half gets its own bays.
    const mixed = planBays(
      edgeOf({
        length: L,
        tags: [
          { s0: 0, s1: L, side: 'both', tag: 'bridge' },
          { s0: L / 2, s1: L, side: 'both', tag: 'old-bridge' },
        ],
      }),
    );
    for (const sp of mixed) {
      const [a, b] = rangeOf(sp);
      const isOld = ['oldArch', 'oldGirder'].includes(kindOf(sp));
      if (isOld) expect(a).toBeGreaterThanOrEqual(L / 2 - 1e-6);
      else expect(b).toBeLessThanOrEqual(L / 2 + 1e-6);
    }
    expect(new Set(mixed.map(kindOf)).size).toBe(3);
  });

  it("puts nothing where there is no bridge, and nothing on another region's bridge", () => {
    expect(planBays(edgeOf({ length: 400, tags: [] }))).toEqual([]);
    expect(planBays(edgeOf({ length: 400, tags: withTags(400, 'palms') }))).toEqual([]);
    // A bridge on a road in a network with no old span (Bahia Honda's, the fictional Keys') is
    // not dressed: the kit is the Seven Mile's.
    expect(planBays(edgeOf({ length: 400, sevenMile: false }))).toEqual([]);
    // The control: the same bridge in the Seven Mile's network is dressed.
    expect(planBays(edgeOf({ length: 400 })).length).toBeGreaterThan(0);
  });

  it('says whether a network is the Seven Mile by its old-bridge tag', () => {
    expect(isSevenMile([[{ tag: 'bridge' }], [{ tag: 'water-open' }, { tag: 'old-bridge' }]])).toBe(true);
    expect(isSevenMile([[{ tag: 'bridge' }], undefined])).toBe(false);
  });

  it('stands the repair platform under a shortcut deck, ten metres at a time', () => {
    const L = 189;
    const spots = planBays(edgeOf({ length: L, shortcutOnly: true }));
    expect(spots.length).toBe(Math.floor(L / BAY_M.staging));
    expect(new Set(spots.map(kindOf))).toEqual(new Set(['staging']));
  });

  describe('a gap (the Moser gap)', () => {
    const L = 530;
    const GAP = { s0: 308.0064, s1: 372.4831 };
    const RAMP = { s0: 292.0064, s1: 339.908 };
    const old = () =>
      planBays(
        edgeOf({
          length: L,
          tags: withTags(L, 'bridge', 'old-bridge'),
          gaps: [GAP],
          ramps: [RAMP],
        }),
      );

    it('ends each side of the gap with a gap end that faces the gap, its far end exactly at the gap boundary', () => {
      const ends = old().filter((s) => kindOf(s) === 'gapEnd');
      expect(ends.length).toBe(2);
      const at = line();
      const near = ends.find((e) => -e.p.z < GAP.s0)!;
      const far = ends.find((e) => -e.p.z > GAP.s1)!;
      expect(dist3(farEnd(near, BAY_M.gapEnd), at(GAP.s0)), 'near end meets the lip').toBeLessThan(0.05);
      expect(dist3(farEnd(far, BAY_M.gapEnd), at(GAP.s1)), 'far end meets the lip').toBeLessThan(0.05);
      // Facing the gap: the near end looks along +s (north, -z), the far end back along -s.
      expect(Math.cos(near.turn)).toBeLessThan(-0.99);
      expect(Math.cos(far.turn)).toBeGreaterThan(0.99);
      // And the road's own broken end (road-mesh draws it at exactly s0 and s1) is where they stand.
      expect(GAP_END_ZONE_M).toBe(BAY_M.gapEnd);
    });

    it('lays no bay over the gap, over the kicker that feeds it, or over a gap end', () => {
      const spots = old();
      const ranges = spots.map((s) => ({ kind: kindOf(s), r: rangeOf(s) }));
      const bays = ranges.filter((x) => x.kind !== 'gapEnd');
      for (const b of bays) {
        expect(
          b.r[1] <= GAP.s0 + 1e-6 || b.r[0] >= GAP.s1 - 1e-6,
          `${b.kind} ${b.r.join('..')} vs the gap`,
        ).toBe(true);
        expect(
          b.r[1] <= RAMP.s0 + 1e-6 || b.r[0] >= RAMP.s1 - 1e-6,
          `${b.kind} ${b.r.join('..')} vs the kicker`,
        ).toBe(true);
      }
      // No two pieces overlap by more than a hair.
      const sorted = [...ranges].sort((a, b) => a.r[0] - b.r[0]);
      for (let i = 0; i + 1 < sorted.length; i++) {
        expect(sorted[i]!.r[1], `${sorted[i]!.kind} then ${sorted[i + 1]!.kind}`).toBeLessThanOrEqual(
          sorted[i + 1]!.r[0] + 1e-6,
        );
      }
      // The control: with no gap or kicker the same bridge has bays across the stretch they cleared.
      const clear = planBays(edgeOf({ length: L, tags: withTags(L, 'bridge', 'old-bridge') }));
      expect(clear.length).toBeGreaterThan(spots.length);
      expect(clear.some((s) => rangeOf(s)[0] < GAP.s1 && rangeOf(s)[1] > GAP.s0)).toBe(true);
    });

    it('draws no gap end where the deck is too short to hold one', () => {
      const short = planBays(
        edgeOf({
          length: 60,
          tags: withTags(60, 'bridge', 'old-bridge'),
          gaps: [{ s0: 5, s1: 30 }],
        }),
      );
      expect(short.filter((s) => kindOf(s) === 'gapEnd').length).toBe(1);
    });
  });
});

// ---- The kit ------------------------------------------------------------------------------------

async function readRepoFile(rel: string): Promise<ArrayBuffer> {
  const mod: string = 'node:fs';
  const fs = (await import(/* @vite-ignore */ mod)) as { readFileSync(p: string): Uint8Array };
  const buf = fs.readFileSync(rel);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const KIT_GLB = await readRepoFile(`packs/base/assets/${MODEL_ASSETS.sevenMileKit}.glb`);
const REAL_KIT = bakeModel('sevenMileKit', readGlb(KIT_GLB));

describe('the kit the planner places (CX2, seven-mile-kit.glb)', () => {
  it('bakes one variant per planned bay kind, each as long as the plan says, from z = 0 along the road', () => {
    expect(REAL_KIT.variants.length).toBe(BAY_ROOTS.length);
    const rows: string[] = [];
    BAY_KINDS.forEach((kind) => {
      const g = REAL_KIT.variants[KINDS.indexOf(rootOf(kind))]!;
      g.computeBoundingBox();
      const box = g.boundingBox!;
      rows.push(`${kind} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
      expect(box.min.z, kind).toBeGreaterThan(-0.05);
      expect(Math.abs(box.max.z - BAY_M[kind]) / BAY_M[kind], kind).toBeLessThan(0.01);
      // Centred across the road, the deck top at y = 0, the pier reaching down by its own number.
      expect(Math.abs((box.min.x + box.max.x) / 2), kind).toBeLessThan(0.1);
      expect(box.min.y, kind).toBeLessThan(0);
      if (PIER_M[kind] > 0) expect(box.min.y, kind).toBeLessThanOrEqual(-PIER_M[kind] + 0.01);
    });
    print(rows.join('; '));
  });

  it('keeps nothing of the gap end above the deck: the barricade and the board stood across the lanes', () => {
    const end = REAL_KIT.variants[KINDS.indexOf('osm_gap_end')]!;
    end.computeBoundingBox();
    expect(end.boundingBox!.max.y).toBeLessThanOrEqual(0.05);
    // The control: the model as the Codex batch made it stands 2 m above the deck at its gap side,
    // so the same measure finds what was cut.
    const scene = readGlb(KIT_GLB);
    const raw = new Box3().setFromObject(scene.getObjectByName('osm_gap_end')!);
    expect(raw.max.y).toBeGreaterThan(1.9);
    // And its underside is whole: the girders and the concrete block under the deck are still there.
    expect(end.boundingBox!.min.y).toBeLessThan(-1);
    expect(end.getAttribute('position').count).toBeGreaterThan(20);
  });

  it("stands the repair platform on piles a camera over its deck sees: outside the rails, from the deck's edge down to the sea (playtest 4, P1)", () => {
    const platform = REAL_KIT.variants[KINDS.indexOf(rootOf('staging'))]!;
    // The kit's own piles and rails stay inside +-3.92 m; the outrigger piles are what this adds. A
    // control: the model as the Codex batch made it has nothing past the rails, so the measure finds the legs.
    const rawRoot = readGlb(KIT_GLB).getObjectByName(rootOf('staging'))!;
    rawRoot.updateMatrixWorld(true);
    const raw = new Box3().setFromObject(rawRoot);
    const rootX = rawRoot.getWorldPosition(new Vector3()).x;
    expect(Math.max(raw.max.x - rootX, rootX - raw.min.x), 'the kit as made').toBeLessThan(4.1);
    const pos = platform.getAttribute('position');
    const col = platform.getAttribute('color');
    const [cr, cg, cb] = STAGING_LEGS.colour;
    // The piles' own vertices, by their colour (the kit has none of it): the top ring of a pile on the
    // +x side, and its foot ring, the mean of each ring being the pile's axis there.
    const mine: { x: number; y: number }[] = [];
    for (let i = 0; i < pos.count; i++)
      if (
        Math.abs(col.getX(i) - cr) < 1e-4 &&
        Math.abs(col.getY(i) - cg) < 1e-4 &&
        Math.abs(col.getZ(i) - cb) < 1e-4
      )
        mine.push({ x: pos.getX(i), y: pos.getY(i) });
    expect(mine.length, 'vertices of the outrigger piles').toBeGreaterThan(40);
    // The repair decks of the real bake stand 4 m over the sea (osm-sm-old-road and its three kin).
    const deckAboveSeaM = 4;
    const top = mine.filter((v) => v.x > 0 && v.y > STAGING_LEGS.topY - 0.2);
    const foot = mine.filter((v) => v.x > 0 && v.y < STAGING_LEGS.footY + 0.2);
    expect(top.length).toBeGreaterThan(0);
    expect(foot.length).toBeGreaterThan(0);
    const meanX = (vs: { x: number }[]) => vs.reduce((a, v) => a + v.x, 0) / vs.length;
    const u = (STAGING_LEGS.topY + deckAboveSeaM) / (STAGING_LEGS.topY - STAGING_LEGS.footY);
    const atWater = meanX(top) + (meanX(foot) - meanX(top)) * u;
    const RAIL_OUTSIDE_M = 3.92 + 0.5;
    print(
      `repair platform piles: ${mine.length} pile vertices, at the waterline ${atWater.toFixed(2)} m from the centre (rails at 3.92 m), the foot ${STAGING_LEGS.footY} m under the deck`,
    );
    expect(atWater, 'the piles meet the water clear of the rails').toBeGreaterThan(RAIL_OUTSIDE_M);
    // They reach the water from a 4 m deck, and past it.
    expect(STAGING_LEGS.footY).toBeLessThan(-deckAboveSeaM);
    // The kit's own triangles come first and unchanged, so its role runs still name them.
    expect(pos.count - mine.length).toBeGreaterThan(0);
    // And the platform still spans its 10 m bay across the centre and reaches the pier's depth.
    platform.computeBoundingBox();
    expect(platform.boundingBox!.min.z).toBeGreaterThan(-0.05);
    expect(platform.boundingBox!.max.z).toBeLessThan(10.3);
  });

  it('loads for a network with an old-bridge tag, and for no other', () => {
    const needs = (tags: string[]) =>
      modelKindsFor({ tropical: true, tags: new Set(tags), palette: new Set(), traffic: [] });
    expect(needs(['bridge', 'water-open', 'old-bridge'])).toContain('sevenMileKit');
    expect(needs(['bridge', 'water-open'])).not.toContain('sevenMileKit');
    expect(
      modelKindsFor({ tropical: false, tags: new Set(['old-bridge']), palette: new Set(), traffic: [] }),
    ).not.toContain('sevenMileKit');
  });
});

// ---- The merged blocks --------------------------------------------------------------------------

/** A code-made bay of the kit's own length: a slab from z = 0 to its length, the deck top at y = 0. */
function slab(kind: BayKind): BufferGeometry {
  return new BoxGeometry(BAY_M.newSpan === BAY_M[kind] ? 11.6 : 6.7, 2, BAY_M[kind]).translate(
    0,
    -1,
    BAY_M[kind] / 2,
  );
}
const FAKE_KIT: SceneryModel = {
  kind: 'sevenMileKit',
  variants: BAY_ROOTS.map((root) => slab(BAY_KINDS.find((k) => rootOf(k) === root)!)),
  doubleSided: false,
};

describe('bays in the merged scenery blocks', () => {
  const material = look.material('prop', { vertexColors: true });
  const bayAt = (x: number, z: number, slope = 0): ScenerySpot => ({
    kind: 'bay',
    variant: 0,
    p: { x, y: 4, z },
    turn: 0,
    size: 1,
    phase: 0,
    edge: 0,
    s: 0,
    d: 0,
    slope,
    reachM: BAY_M.newSpan,
  });
  const item = (spot: ScenerySpot, geometry = FAKE_KIT.variants[0]!) => ({ spot, geometry, material });

  it('merge by the square they are given: bays in one square are one mesh, bays in two are two', () => {
    const one = new MergedScenery(
      [item(bayAt(10, 10)), item(bayAt(60, 60)), item(bayAt(100, 20))],
      undefined,
      BAY_BLOCK_M,
    );
    expect(one.count).toBe(1);
    const two = new MergedScenery(
      [item(bayAt(10, 10)), item(bayAt(10 + BAY_BLOCK_M, 10))],
      undefined,
      BAY_BLOCK_M,
    );
    expect(two.count).toBe(2);
    // The scatter's own squares are smaller (the reason bays have squares of their own).
    expect(BAY_BLOCK_M).toBeGreaterThan(SCENERY_BLOCK_M);
  });

  it('draws a sloping bay on the slope: its far end rises by slope times its length, its start stays put', () => {
    const slope = 0.05;
    const built = (s: number) => {
      const m = new MergedScenery([item(bayAt(0, 0, s))]);
      m.update(0, 0, 400, 400, 1);
      const mesh = m.group.children[0] as Mesh;
      mesh.geometry.computeBoundingBox();
      return mesh.geometry.boundingBox!;
    };
    const flat = built(0);
    const up = built(slope);
    expect(flat.max.y).toBeCloseTo(4, 3);
    expect(up.max.y - flat.max.y).toBeCloseTo(slope * BAY_M.newSpan, 3);
    // The start did not move, and the footprint did not stretch along the road (a shear, not a tilt).
    expect(up.min.z).toBeCloseTo(flat.min.z, 4);
    expect(up.max.z).toBeCloseTo(flat.max.z, 4);
  });

  it("counts a bay's whole length when it culls a block, not only its origin", () => {
    // A bay's far end is 41 m from its origin; a camera whose draw distance reaches the far end only
    // still sees the block.
    const m = new MergedScenery([item(bayAt(0, 0))]);
    const drawM = 100;
    m.update(0, BAY_M.newSpan + drawM - 2, drawM, drawM, 1);
    expect(m.counts().meshes).toBe(1);
    // The control: a camera a few metres farther than that sees nothing.
    const none = new MergedScenery([item(bayAt(0, 0))]);
    none.update(0, BAY_M.newSpan + drawM + 100, drawM, drawM, 1);
    expect(none.counts().meshes).toBe(0);
  });
});

// ---- The road scene -----------------------------------------------------------------------------

const KITS: SceneryModels = { sevenMileKit: FAKE_KIT };

function bridgeScene(
  length: number,
  over: {
    kit?: SceneryModels;
    features?: { kind: string; s0: number; s1: number; d0: number; d1: number }[];
    sevenMile?: boolean;
  } = {},
): { scene: RoadScene; road: RoadNetwork } {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'r', lengthM: length, kappa: 0 }]));
  const dressing: RoadDressing = {
    r: {
      features: over.features ?? [],
      tags: [
        { s0: 0, s1: length, side: 'both', tag: 'bridge' },
        { s0: 0, s1: length, side: 'both', tag: 'water-open' },
        ...(over.sevenMile === false ? [] : [{ s0: 0, s1: length, side: 'both', tag: 'old-bridge' }]),
      ],
    },
  };
  const scene = buildRoadScene(road, look, dressing, {
    roadsideDensity: 0,
    models: over.kit ?? KITS,
    seed: 3,
  });
  return { scene, road };
}

describe('the bays in the road scene', () => {
  it("are placed from the road's own tags and counted, and a network with no kit draws none and does not throw", () => {
    const withKit = bridgeScene(1000);
    expect(withKit.scene.bays.length).toBeGreaterThan(20);
    expect(withKit.scene.stats.scenery.bay).toBe(withKit.scene.bays.length);
    expect(withKit.scene.stats.sceneryModels).toContain('bay');
    const without = bridgeScene(1000, { kit: {} });
    expect(without.scene.bays).toEqual([]);
    expect(without.scene.stats.scenery.bay).toBe(0);
    // They are not scatter spots: nothing that reads `spots` (the roadside layer, the sweeps) sees them.
    expect(withKit.scene.spots.some((s) => s.kind === 'bay')).toBe(false);
  });

  it('puts a gap end on each side of a gap the road draws', () => {
    const { scene } = bridgeScene(600, {
      features: [{ kind: 'gap', s0: 250, s1: 330, d0: -5.5, d1: 5.5 }],
    });
    expect(scene.stats.gapEnds).toBe(2);
    expect(scene.bays.filter((s) => lengthOfVariant(s) === BAY_M.gapEnd).length).toBe(2);
  });

  it('builds no bay farther than a kilometre from the camera, whatever the scenery draw distance', () => {
    const { scene } = bridgeScene(4000);
    // The slider's top end, 760 m, with a block built every call: the most any setting can ask for.
    scene.update(0, 0, 0, 760, 200, 200);
    const reach: number[] = [];
    scene.group.traverse((o) => {
      if (!(o instanceof Mesh) || o.name !== 'road-scenery') return;
      const geo = o.geometry as BufferGeometry;
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      // The farthest corner of what was built, in the ground plane.
      const x = Math.max(Math.abs(box.min.x), Math.abs(box.max.x));
      const z = Math.max(Math.abs(box.min.z), Math.abs(box.max.z));
      reach.push(Math.hypot(x, z));
    });
    expect(reach.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...reach)).toBeLessThan(1000);
    // By construction too: a block is built from `BAY_DRAW_M` plus a prefetch of 80 m out, and a
    // square's far corner is its diagonal further.
    expect(BAY_DRAW_M + 80 + BAY_BLOCK_M * Math.SQRT2).toBeLessThan(1000);
    // The control: bays do stand past a kilometre (the scene has them, so the cap is the camera's),
    // and most of the blocks were left unbuilt.
    expect(Math.max(...scene.bays.map((b) => Math.abs(b.p.z)))).toBeGreaterThan(3000);
    const counts = scene.merged();
    expect(counts.built).toBeLessThan(counts.blocks / 2);
    print(
      `4 km bridge, ${scene.bays.length} bays, ${counts.built} of ${counts.blocks} blocks built at 760 m, farthest corner ${Math.max(...reach).toFixed(0)} m`,
    );
  });

  it('cost a few meshes a view, not one per 160 m of bridge', () => {
    const withBays = bridgeScene(4000).scene;
    const bare = bridgeScene(4000, { kit: {} }).scene;
    const rows: string[] = [];
    let worst = 0;
    let least = Infinity;
    for (const s of [150, 700, 1400, 2200, 3000, 3850]) {
      const meshes = (scene: RoadScene) => {
        scene.update(0, -s, 0, 360, 200, 400);
        return scene.merged().meshes;
      };
      const extra = meshes(withBays) - meshes(bare);
      worst = Math.max(worst, extra);
      least = Math.min(least, extra);
      rows.push(`s ${s}: +${extra}`);
    }
    // The straight bridge crosses at most three 320 m squares within 300 m of the camera.
    expect(worst).toBeLessThanOrEqual(3);
    expect(least).toBeGreaterThanOrEqual(1);
    print(`bay meshes added along a 4 km bridge: ${rows.join(', ')}`);
  });
});

const lengthOfVariant = (s: ScenerySpot): number =>
  BAY_M[BAY_KINDS.find((k) => KINDS.indexOf(rootOf(k)) === s.variant)!];

// ---- The real bake ------------------------------------------------------------------------------

const networkFiles = import.meta.glob<BakedNetwork>(
  '../../packs/base/regions/florida-keys/networks/osm-keys-seven-mile.json',
  { eager: true, import: 'default' },
);
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/florida-keys/roads/osm-*.json', {
  eager: true,
  import: 'default',
});

function sevenMile(kit: SceneryModels): {
  scene: RoadScene;
  road: RoadNetwork;
  roads: BakedRoad[];
  dressing: RoadDressing;
} {
  const network = Object.values(networkFiles)[0]!;
  const roads = network.roads.map((id) => Object.values(roadFiles).find((r) => r.id === id)!);
  const dressing = Object.fromEntries(roads.map((r) => [r.id, r])) as unknown as RoadDressing;
  const road = createRoadNetwork({ network, roads });
  return {
    scene: buildRoadScene(road, look, dressing, { roadsideDensity: 1, models: kit, seed: 5 }),
    road,
    roads,
    dressing,
  };
}

describe('the baked Seven Mile with the real kit', () => {
  const REAL: SceneryModels = { sevenMileKit: REAL_KIT };
  const built = sevenMile(REAL);
  const feature = (road: BakedRoad, kind: string) =>
    (
      (road as unknown as { features?: { kind: string; s0: number; s1: number; id?: string }[] }).features ??
      []
    ).filter((f) => f.kind === kind);
  const tagsOf = (road: BakedRoad) =>
    ((road as unknown as { tags?: { tag: string }[] }).tags ?? []).map((t) => t.tag);
  const edgeIndex = (id: string) => built.road.edges.findIndex((e) => e.id === id);

  it("is the Seven Mile by the road's own tags, and loads the kit for it", () => {
    const { tropical, tags } = networkTags(built.road, built.dressing);
    expect(modelKindsFor({ tropical, tags, palette: new Set(), traffic: [] })).toContain('sevenMileKit');
    expect(built.scene.stats.scenery.bay).toBeGreaterThan(300);
  });

  it('dresses the new span with new bays, the old bridge with old ones, the repair decks with platforms', () => {
    const counts = new Map<string, Set<BayKind>>();
    for (const sp of built.scene.bays) {
      const id = built.road.edges[sp.edge]!.id;
      const set = counts.get(id) ?? new Set<BayKind>();
      set.add(kindOf(sp));
      counts.set(id, set);
    }
    const kindsOn = (id: string) => [...(counts.get(id) ?? [])].sort();
    expect(kindsOn('osm-sm-bridge')).toEqual(['newSpan', 'newSpanTall']);
    expect(kindsOn('osm-sm-old-west')).toEqual(['oldArch', 'oldGirder']);
    expect(kindsOn('osm-sm-old-east')).toEqual(['oldArch', 'oldGirder']);
    expect(kindsOn('osm-sm-old-road')).toEqual(['gapEnd', 'staging']);
    // The control: the land roads at either end of the bridge get no bay.
    expect(kindsOn('osm-sm-knights-key')).toEqual([]);
    expect(kindsOn('osm-sm-little-duck-key')).toEqual([]);
    // Every bay of a tagged span stands on a road that carries the tag its bays need.
    for (const sp of built.scene.bays) {
      const road = built.roads.find((r) => r.id === built.road.edges[sp.edge]!.id)!;
      expect(tagsOf(road), road.id).toContain('bridge');
    }
    print([...counts.entries()].map(([id, k]) => `${id} ${[...k].sort().join('+')}`).join('; '));
  });

  it("stands a gap end on each side of the Moser gap and of both repair gaps, exactly at the road's broken ends", () => {
    const rows: string[] = [];
    for (const id of ['osm-sm-old-moser', 'osm-sm-old-road', 'osm-sm-old-road-back']) {
      const road = built.roads.find((r) => r.id === id)!;
      const gap = feature(road, 'gap')[0]!;
      const index = edgeIndex(id);
      const ends = built.scene.bays.filter((s) => s.edge === index && lengthOfVariant(s) === BAY_M.gapEnd);
      expect(ends.length, id).toBe(2);
      const lip = (s: number) => built.road.toWorld(index, s, 0, 0);
      const near = ends.find((e) => e.s < gap.s0)!;
      const far = ends.find((e) => e.s > gap.s1)!;
      expect(dist3(farEnd(near, BAY_M.gapEnd), lip(gap.s0)), `${id} near`).toBeLessThan(0.05);
      expect(dist3(farEnd(far, BAY_M.gapEnd), lip(gap.s1)), `${id} far`).toBeLessThan(0.05);
      rows.push(`${id} gap ${gap.s0.toFixed(1)}..${gap.s1.toFixed(1)}`);
    }
    print(`gap ends: ${rows.join('; ')}`);
  });

  it('lays no bay over any gap or kicker, and none overlaps another, on every road', () => {
    for (const road of built.roads) {
      const index = edgeIndex(road.id);
      const mine = built.scene.bays.filter((s) => s.edge === index);
      const zones = [...feature(road, 'gap'), ...feature(road, 'ramp')];
      const spans = mine.map((s) => {
        const len = lengthOfVariant(s);
        const s1 = (() => {
          // The far end's s: walk to it along the road (a bay runs +s except a far gap end).
          const fwd = built.road.toWorld(index, Math.min(s.s + len, built.road.edges[index]!.length), 0, 0);
          const back = built.road.toWorld(index, Math.max(s.s - len, 0), 0, 0);
          const towardFwd = Math.hypot(fwd.x - farEnd(s, len).x, fwd.z - farEnd(s, len).z);
          const towardBack = Math.hypot(back.x - farEnd(s, len).x, back.z - farEnd(s, len).z);
          return towardFwd <= towardBack ? s.s + len : s.s - len;
        })();
        return [Math.min(s.s, s1), Math.max(s.s, s1)] as const;
      });
      spans.forEach((sp, i) => {
        const kind = kindOf(mine[i]!);
        for (const z of zones) {
          const lo = Math.min(z.s0, z.s1);
          const hi = Math.max(z.s0, z.s1);
          if (kind === 'gapEnd') continue;
          expect(
            sp[1] <= lo + 0.05 || sp[0] >= hi - 0.05,
            `${road.id} ${kind} ${sp.join('..')} vs ${lo}..${hi}`,
          ).toBe(true);
        }
      });
      const sorted = [...spans].sort((a, b) => a[0] - b[0]);
      for (let i = 0; i + 1 < sorted.length; i++) {
        expect(sorted[i]![1], road.id).toBeLessThanOrEqual(sorted[i + 1]![0] + 0.05);
      }
    }
  });

  it('adds at most 4 draw calls to any view of the route (the plan allows 5 for all its art), and none with no kit', () => {
    const bare = sevenMile({});
    // What the renderer draws: the merged meshes that are visible and inside the chase camera's
    // frustum (a few metres behind the rider, a few up, looking down the road, 62 degrees).
    const meshesAt = (run: typeof built, id: string, s: number): number => {
      const edge = run.road.edges.findIndex((e) => e.id === id);
      const at = run.road.toWorld(edge, s, 0, 0);
      const ahead = run.road.toWorld(edge, s + 30, 0, 0);
      const behind = run.road.toWorld(edge, Math.max(0, s - 7), 0, 0);
      run.scene.update(at.x, at.z, 0, 360, 200, 400);
      const cam = new PerspectiveCamera(62, 915 / 412, 0.3, 760);
      cam.position.set(behind.x, behind.y + 3.2, behind.z);
      cam.lookAt(ahead.x, ahead.y + 1.5, ahead.z);
      cam.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
      );
      let n = 0;
      run.scene.group.traverse((o) => {
        if (o instanceof Mesh && o.name === 'road-scenery' && o.visible && frustum.intersectsObject(o)) n++;
      });
      return n;
    };
    const cams: [string, number][] = [
      ['osm-sm-bridge', 500],
      ['osm-sm-bridge', 5000],
      ['osm-sm-bridge', 9000],
      ['osm-sm-old-moser', 150],
      ['osm-sm-old-moser', 300],
      ['osm-sm-old-moser', 450],
      ['osm-sm-old-road', 60],
      ['osm-sm-old-west', 2500],
    ];
    const rows: string[] = [];
    let worst = 0;
    let least = Infinity;
    for (const [id, s] of cams) {
      const a = meshesAt(built, id, s);
      const b = meshesAt(bare, id, s);
      worst = Math.max(worst, a - b);
      least = Math.min(least, a - b);
      rows.push(`${id}@${s}: ${b} -> ${a}`);
    }
    print(`merged scenery meshes in view, no kit -> kit: ${rows.join('; ')}`);
    expect(worst).toBeLessThanOrEqual(4);
    // The control: the kit does draw something at every one of those cameras.
    expect(least).toBeGreaterThanOrEqual(1);
    expect(bare.scene.stats.scenery.bay).toBe(0);
  });
});
