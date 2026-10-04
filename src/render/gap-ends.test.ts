// A gap in the road reads as a broken bridge end you can see coming, not a hole in the deck
// (playtest 3, T11.1; the maintainer, 2026-10-03: "the 7 mile bridge has an old road parallel to it.
// Jumps could let you get from one to the other"; round 3: "the real 80 m missing span is the big
// jump"). The sim has no surface over a `gap` feature's box (docs/architecture.md, "Jumps, ramps and
// airtime"); render draws none there either, ends the deck in a raw-concrete face with rebar
// tufts at each end, and gives a kicker that feeds the gap its cheeks and a striped lip.
import { InstancedMesh, Mesh, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type BakedNetworkBundle } from '../road';
import { createFlatLook } from './look';
import { buildRoadScene, type FeatureSpan, type RoadDressing, type RoadScene } from './road-mesh';

const look = createFlatLook();

const DECK_Y = 7;
const LENGTH = 400;
const GAP = { s0: 150, s1: 230 };

interface Tri {
  mesh: string;
  /** The three corners as [s, d-ish x, y]: s = -z (the fixture road runs north, -z), x across. */
  p: readonly [number, number, number][];
}

/** A flat, elevated 400 m road (a bridge deck), with an optional ramp bake raised into its y profile. */
function bridge(opts: { ramp?: { s0: number; lengthM: number; heightM: number } } = {}): BakedNetworkBundle {
  const bundle = fixtureNetwork([{ id: 'r', lengthM: LENGTH, kappa: 0 }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
  const data = road.samples.data;
  const ys = data['y'] as number[] | undefined;
  const n = ys?.length ?? 0;
  const spacing = road.sampleSpacingM;
  for (let i = 0; i < n; i++) {
    const s = i * spacing;
    let y = DECK_Y;
    const r = opts.ramp;
    if (r && s > r.s0 && s <= r.s0 + r.lengthM) y += r.heightM * ((s - r.s0) / r.lengthM) ** 2;
    if (ys) ys[i] = y;
  }
  return bundle;
}

function gap(s0 = GAP.s0, s1 = GAP.s1): FeatureSpan {
  return { kind: 'gap', id: 'moser', s0, s1, d0: -5, d1: 5 };
}

function sceneOf(features: FeatureSpan[], bundle = bridge()): RoadScene {
  const road = createRoadNetwork(bundle);
  const dressing: RoadDressing = {
    r: { features, tags: [{ s0: 0, s1: LENGTH, side: 'both', tag: 'bridge' }] },
  };
  return buildRoadScene(road, look, dressing, { roadsideDensity: 0 });
}

function trisOf(scene: RoadScene): Tri[] {
  const out: Tri[] = [];
  scene.group.traverse((o) => {
    if (!(o instanceof Mesh) || o instanceof InstancedMesh) return;
    const g = o.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    const at = (k: number): [number, number, number] => {
      const v = idx ? idx.getX(k) : k;
      return [-pos.getZ(v), pos.getX(v), pos.getY(v)];
    };
    for (let k = 0; k + 2 < count; k += 3) out.push({ mesh: o.name, p: [at(k), at(k + 1), at(k + 2)] });
  });
  return out;
}

/** World positions (s, y) of every instance of the named instanced meshes. */
function instancesOf(scene: RoadScene, names: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  scene.group.traverse((o) => {
    if (!(o instanceof InstancedMesh) || !names.includes(o.name)) return;
    const e = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) out.push([-(e[i * 16 + 14] ?? 0), e[i * 16 + 13] ?? 0]);
  });
  return out;
}

const SURFACES = new Set(['road-road', 'road-shoulder', 'road-marking', 'road-markingCenter']);
const EPS = 1e-3;

/** The triangles whose s-range reaches into the open interval (s0, s1). */
function inside(tris: Tri[], names: ReadonlySet<string>, s0: number, s1: number): Tri[] {
  return tris.filter((t) => {
    if (!names.has(t.mesh)) return false;
    const ss = t.p.map((q) => q[0]);
    return Math.max(...ss) > s0 + EPS && Math.min(...ss) < s1 - EPS;
  });
}

describe('a gap in the road (playtest 3, T11.1)', () => {
  it('draws no road surface, marking, fascia, rail or pylon over the gap (and does where there is none)', () => {
    const barriers = [{ s0: 0, s1: LENGTH, side: 'both', kind: 'rail', heightM: 1 }];
    const withGap = (features: FeatureSpan[]) => {
      const road = createRoadNetwork(bridge());
      return buildRoadScene(
        road,
        look,
        { r: { features, barriers, tags: [{ s0: 0, s1: LENGTH, side: 'both', tag: 'bridge' }] } },
        { roadsideDensity: 0 },
      );
    };
    const solid = withGap([]);
    const holed = withGap([gap()]);
    const layers = new Set([...SURFACES, 'road-rail']);
    // The control: the same check on the unbroken deck finds the surfaces it is looking for.
    const control = inside(trisOf(solid), layers, GAP.s0, GAP.s1);
    expect(control.length).toBeGreaterThan(30);
    expect(new Set(control.map((t) => t.mesh))).toEqual(new Set([...layers]));
    expect(inside(trisOf(holed), layers, GAP.s0, GAP.s1)).toEqual([]);
    // The fascia, the stub faces aside: nothing of the deck's sides hangs in the gap either.
    const faceOnly = (t: Tri) =>
      t.p.every((q) => Math.abs(q[0] - GAP.s0) < EPS || Math.abs(q[0] - GAP.s1) < EPS);
    const deckTris = inside(trisOf(holed), new Set(['road-deck']), GAP.s0, GAP.s1).filter(
      (t) => !faceOnly(t),
    );
    expect(deckTris).toEqual([]);
    expect(inside(trisOf(solid), new Set(['road-deck']), GAP.s0, GAP.s1).length).toBeGreaterThan(10);
    // Posts and pylons stand outside it.
    const stood = (s: ReturnType<typeof withGap>) =>
      instancesOf(s, ['road-posts', 'road-rail-posts', 'road-pylons']).filter(
        ([s0]) => s0 > GAP.s0 + EPS && s0 < GAP.s1 - EPS,
      );
    expect(stood(solid).length).toBeGreaterThan(5);
    expect(stood(holed)).toEqual([]);
  });

  it('ends the deck exactly at the gap, on both sides, whatever the 2 m sampling', () => {
    // 151.3 and 228.9 fall between two samples: the surface still reaches them, not the sample before.
    const scene = sceneOf([gap(151.3, 228.9)]);
    const tris = trisOf(scene).filter((t) => t.mesh === 'road-road');
    const reach = (pick: (s: number) => boolean) => tris.flatMap((t) => t.p.map((q) => q[0])).filter(pick);
    expect(Math.max(...reach((s) => s <= 151.3 + EPS))).toBeCloseTo(151.3, 3);
    expect(Math.min(...reach((s) => s >= 228.9 - EPS))).toBeCloseTo(228.9, 3);
    expect(reach((s) => s > 151.3 + EPS && s < 228.9 - EPS)).toEqual([]);
  });

  it('stands a raw-concrete face at each end, as deep as the fascia beside it, with a broken edge', () => {
    const scene = sceneOf([gap()]);
    expect(scene.stats.gapEnds).toBe(2);
    const faces = trisOf(scene).filter(
      (t) => t.mesh === 'road-deck' && t.p.every((q) => Math.abs(q[0] - GAP.s0) < EPS),
    );
    expect(faces.length).toBeGreaterThanOrEqual(4);
    const ys = faces.flatMap((t) => t.p.map((q) => q[2]));
    const xs = faces.flatMap((t) => t.p.map((q) => q[1]));
    // From the deck's edge (a hair under the surface) down about a metre, jagged along the bottom.
    expect(Math.max(...ys)).toBeCloseTo(DECK_Y - 0.02, 2);
    expect(DECK_Y - Math.min(...ys)).toBeGreaterThan(1);
    expect(DECK_Y - Math.min(...ys)).toBeLessThan(1.6);
    expect(new Set(faces.flatMap((t) => t.p.map((q) => q[2].toFixed(2)))).size).toBeGreaterThan(3);
    // Across the whole drawn width, shoulders included.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(10);
    // And the far end has its own.
    expect(
      trisOf(scene).some((t) => t.mesh === 'road-deck' && t.p.every((q) => Math.abs(q[0] - GAP.s1) < EPS)),
    ).toBe(true);
  });

  it('puts two rebar tufts on each face, sticking out into the gap', () => {
    const scene = sceneOf([gap()]);
    const bars = trisOf(scene).filter((t) => t.mesh === 'road-rebar');
    expect(bars.length).toBeGreaterThan(0);
    const reachInto = (t: Tri, from: number, sign: 1 | -1) =>
      Math.max(...t.p.map((q) => (q[0] - from) * sign));
    const near = bars.filter((t) => t.p.some((q) => Math.abs(q[0] - GAP.s0) < 0.9));
    const far = bars.filter((t) => t.p.some((q) => Math.abs(q[0] - GAP.s1) < 0.9));
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    // Into the gap: ahead of the near face, behind the far one, by up to 0.6 m and no more.
    expect(Math.max(...near.map((t) => reachInto(t, GAP.s0, 1)))).toBeGreaterThan(0.4);
    expect(Math.max(...near.map((t) => reachInto(t, GAP.s0, 1)))).toBeLessThanOrEqual(0.6 + EPS);
    expect(Math.max(...far.map((t) => reachInto(t, GAP.s1, -1)))).toBeGreaterThan(0.4);
    // Two tufts per face: the bars fall in two clusters across the road.
    const tuftsAt = (list: Tri[]) => {
      const xs = list.map((t) => t.p.reduce((a, q) => a + q[1], 0) / 3).sort((a, b) => a - b);
      let clusters = 1;
      for (let i = 1; i < xs.length; i++) if (xs[i]! - xs[i - 1]! > 1) clusters++;
      return clusters;
    };
    expect(tuftsAt(near)).toBe(2);
    expect(tuftsAt(far)).toBe(2);
  });

  it('stripes the lip of each end, so the broken end can be seen coming', () => {
    const solid = sceneOf([]);
    const holed = sceneOf([gap()]);
    const stripes = (s: RoadScene, lo: number, hi: number) =>
      trisOf(s).filter(
        (t) => t.mesh === 'road-rampMark' && t.p.every((q) => q[0] >= lo - EPS && q[0] <= hi + EPS),
      );
    expect(stripes(solid, GAP.s0 - 4, GAP.s0).length).toBe(0);
    expect(stripes(holed, GAP.s0 - 4, GAP.s0).length).toBeGreaterThanOrEqual(4);
    expect(stripes(holed, GAP.s1, GAP.s1 + 4).length).toBeGreaterThanOrEqual(4);
  });

  it('leaves an edge with no gap exactly as it was', () => {
    const plain = sceneOf([]);
    const aGapElsewhere = sceneOf([{ kind: 'billboard', id: 'b', s0: 10, s1: 12, d0: 5, d1: 6 }]);
    expect(aGapElsewhere.stats.triangles).toBe(plain.stats.triangles);
    expect(plain.stats.gapEnds).toBe(0);
    expect(plain.stats.kickers).toBe(0);
  });

  it('gives a ramp that feeds a gap its cheeks, down to the level it rises from', () => {
    const ramp = { s0: 134, lengthM: 16, heightM: 2 };
    const feature: FeatureSpan = { kind: 'ramp', id: 'kicker', s0: 134, s1: 150, d0: -5, d1: 5 };
    const cheeks = (s: RoadScene) =>
      trisOf(s).filter(
        (t) =>
          t.mesh === 'road-deck' &&
          t.p.every((q) => q[0] >= ramp.s0 - EPS && q[0] <= 150 + EPS) &&
          t.p.every((q) => Math.abs(Math.abs(q[1]) - 5.5) < 0.2),
      );
    // The lip stands 2 m over the deck: a fascia that drops a metre under the lifted edge leaves the
    // wedge open under the ramp, which the cheeks close down to the deck's own fascia depth.
    const noGap = sceneOf([feature], bridge({ ramp }));
    const fed = sceneOf([feature, gap()], bridge({ ramp }));
    const lowest = (s: RoadScene) => {
      const nearLip = cheeks(s).filter((t) => t.p.some((q) => q[0] > 148));
      return Math.min(...nearLip.flatMap((t) => t.p.map((q) => q[2])));
    };
    expect(fed.stats.kickers).toBe(1);
    expect(noGap.stats.kickers).toBe(0);
    // Without the gap the fascia hangs 1 m under the lifted edge (about 7.7 m); with the cheek it
    // reaches the deck's own fascia floor (6 m, 1 m under the level the ramp rises from).
    expect(lowest(noGap)).toBeGreaterThan(DECK_Y + 0.5);
    expect(lowest(fed)).toBeLessThan(DECK_Y - 0.9);
    expect(lowest(fed)).toBeGreaterThan(DECK_Y - 1.2);
  });

  it('does not take a ramp far from the gap for a kicker', () => {
    const feature: FeatureSpan = { kind: 'ramp', id: 'far', s0: 40, s1: 56, d0: -5, d1: 5 };
    expect(
      sceneOf([feature, gap()], bridge({ ramp: { s0: 40, lengthM: 16, heightM: 2 } })).stats.kickers,
    ).toBe(0);
  });
});
