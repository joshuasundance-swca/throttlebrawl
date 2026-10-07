// Barrier looks as a seam (playtest 4, P4-19, run C5; the identity sheets' "seams several fixes share":
// barrier looks for CR1, H2 and I1). A look is a row of `BARRIER_LOOK_STYLES`; a road's tag brings one by
// default (`BARRIER_LOOK_BY_TAG`); the verge layer draws a look's panels along its barrier and along a hard
// verge edge; the road leaves the solid band of a barrier with a look out. Each rule is checked on the
// rule, not on the one look that uses it today: every look in the vocabulary, every tag in the table.
import { Box3, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  highwayLanes,
  type BakedBarrier,
  type BakedTag,
  type RoadNetwork,
} from '../road';
import {
  BARRIER_LOOK_BY_TAG,
  BARRIER_LOOK_STYLES,
  barrierLookAt,
  tagLook,
  type BarrierLook,
  type LookTag,
} from './barrier-looks';
import { mergeBoxes } from './geometry';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { LOOK_RAMP_CLEAR_M, VergeLayer } from './verge';

const look = createFlatLook();
/** Every look the table draws (the vocabulary is held to it in tools/gis/barrier-looks-vocabulary.test.ts). */
const BARRIER_LOOKS = Object.keys(BARRIER_LOOK_STYLES) as BarrierLook[];
const LENGTH = 800;
const tag = (name: string, side: BakedTag['side'] = 'both'): BakedTag => ({
  s0: 0,
  s1: LENGTH,
  side,
  tag: name,
});

function roadWith(opts: { barriers?: BakedBarrier[]; tags?: BakedTag[] }): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'r', lengthM: LENGTH, kappa: 0, lanes: highwayLanes(2) }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
  return createRoadNetwork({
    network: bundle.network,
    roads: [{ ...road, barriers: opts.barriers ?? [], tags: opts.tags ?? [] }],
  });
}

const layerOf = (road: RoadNetwork) => new VergeLayer(road, look, { tags: new Set() });
const meshNames = (verge: VergeLayer): string[] => {
  const out: string[] = [];
  verge.group.traverse((o: Object3D) => {
    if (
      o instanceof InstancedMesh &&
      (BARRIER_LOOKS as readonly string[]).includes(o.name.replace('verge-', ''))
    )
      out.push(o.name);
  });
  return out;
};
const wall = (extra: Partial<BakedBarrier> = {}): BakedBarrier => ({
  s0: 100,
  s1: 300,
  side: 'both',
  kind: 'wall',
  heightM: 0.9,
  ...extra,
});

describe('the table of looks', () => {
  it('draws each look as a handful of boxes standing on the ground, as tall as it says', () => {
    for (const name of BARRIER_LOOKS) {
      const style = BARRIER_LOOK_STYLES[name];
      const geo = mergeBoxes(style.parts('#c0452f'));
      geo.computeBoundingBox();
      const box = geo.boundingBox ?? new Box3();
      expect(box.min.y, name).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y, name).toBeCloseTo(style.heightM, 2);
      // A panel is as long as it says, and no longer: the next one butts against it.
      expect(box.max.x - box.min.x, name).toBeLessThanOrEqual(style.segM + 1e-6);
      // The near set holds up to 400 panels per look: keep a panel to a few faces.
      const tris = (geo.getIndex()?.count ?? 0) / 3;
      expect(tris, `${name} triangles per panel`).toBeLessThanOrEqual(40);
      geo.dispose();
    }
  });

  it("stands each look's inner face on the lanes' edge, where the sim stops a rider (not inside it, not a body away)", () => {
    for (const name of BARRIER_LOOKS) {
      const style = BARRIER_LOOK_STYLES[name];
      const geo = mergeBoxes(style.parts('#c0452f'));
      geo.computeBoundingBox();
      const inner = (geo.boundingBox?.max.z ?? 0) - style.outM;
      // The panel is symmetric across the road, so one number covers both sides.
      expect(geo.boundingBox?.min.z, name).toBeCloseTo(-(geo.boundingBox?.max.z ?? 0), 3);
      expect(inner, `${name}: how far its inner face is inside the edge`).toBeLessThanOrEqual(0.1);
      expect(inner, `${name}: how far its inner face is outside the edge`).toBeGreaterThanOrEqual(-0.1);
      geo.dispose();
    }
  });

  it('keeps the railing exactly as the Golden Gate drew it (2 m panels, 1.3 m, 120 m)', () => {
    const r = BARRIER_LOOK_STYLES.railing;
    expect([r.segM, r.heightM, r.outM, r.drawM]).toEqual([2, 1.3, 0.2, 120]);
  });
});

describe('which look a barrier wears', () => {
  const tags: LookTag[] = [{ s0: 0, s1: 500, tag: 'interstate' }];

  it("is its own `look` first, then its road tag's look for its kind, else none", () => {
    expect(barrierLookAt({ kind: 'wall', look: 'railing' }, tags, 'left', 10)).toBe('railing');
    expect(barrierLookAt({ kind: 'wall' }, tags, 'left', 10)).toBe('concrete');
    expect(barrierLookAt({ kind: 'rail' }, tags, 'right', 10)).toBe('guardrail');
    // The control: the same barriers on an untagged road have no look, so a "none" here is a real none.
    expect(barrierLookAt({ kind: 'wall' }, [], 'left', 10)).toBeUndefined();
    expect(barrierLookAt({ kind: 'rail' }, [{ s0: 0, s1: 500, tag: 'forest' }], 'right', 10)).toBeUndefined();
    // A look the build does not know is drawn as the barrier's kind, not as a crash.
    expect(barrierLookAt({ kind: 'wall', look: 'stone-arch' }, tags, 'left', 10)).toBeUndefined();
  });

  it('follows the tag only where it covers, on the side it covers', () => {
    const part: LookTag[] = [{ s0: 100, s1: 200, side: 'right', tag: 'interstate' }];
    expect(barrierLookAt({ kind: 'wall' }, part, 'right', 150)).toBe('concrete');
    expect(barrierLookAt({ kind: 'wall' }, part, 'right', 250)).toBeUndefined();
    expect(barrierLookAt({ kind: 'wall' }, part, 'left', 150)).toBeUndefined();
  });

  it('names only looks the table has, for every tag in the table', () => {
    for (const [name, looks] of Object.entries(BARRIER_LOOK_BY_TAG))
      for (const want of ['rail', 'wall', 'edge'] as const) {
        const l = looks[want];
        if (l !== undefined) expect(BARRIER_LOOKS, `${name}.${want}`).toContain(l);
      }
    expect(tagLook([{ s0: 0, s1: 9, tag: 'interstate' }], 'left', 4, 'edge')).toBe('guardrail');
  });
});

describe('the verge layer draws a look along its barrier', () => {
  it('draws each look the barrier names, one panel per segment on each side, in a mesh of its own', () => {
    for (const name of BARRIER_LOOKS) {
      const verge = layerOf(roadWith({ barriers: [wall({ look: name })] }));
      const seg = BARRIER_LOOK_STYLES[name].segM;
      expect(verge.counts().looks[name]?.panels, name).toBe(2 * ((300 - 100) / seg));
      // Only the look in use has a mesh; the others are not in the scene.
      expect(meshNames(verge), name).toEqual([`verge-${name}`]);
    }
  });

  it('gives a barrier with no look its road tag, and not an untagged road', () => {
    // A barrier along the whole road, so the shoulder's own rail (below) has no stretch left to stand on.
    const whole = { s0: 0, s1: LENGTH };
    const tagged = layerOf(roadWith({ barriers: [wall(whole)], tags: [tag('interstate')] }));
    expect(tagged.counts().looks).toEqual({ concrete: { panels: LENGTH, near: 0 } });
    const rail = layerOf(
      roadWith({ barriers: [wall({ ...whole, kind: 'rail' })], tags: [tag('interstate')] }),
    );
    expect(rail.counts().looks).toEqual({ guardrail: { panels: LENGTH, near: 0 } });
    const plain = layerOf(roadWith({ barriers: [wall(whole)], tags: [tag('forest')] }));
    expect(plain.counts().looks).toEqual({});
    expect(meshNames(plain)).toEqual([]);
  });

  it("lets a barrier's own look beat its road's tag", () => {
    const whole = { s0: 0, s1: LENGTH, look: 'railing' as const };
    const verge = layerOf(roadWith({ barriers: [wall(whole)], tags: [tag('interstate')] }));
    expect(Object.keys(verge.counts().looks)).toEqual(['railing']);
  });

  it('draws only the panels inside the look drawing distance of the camera', () => {
    for (const name of BARRIER_LOOKS) {
      const road = roadWith({ barriers: [wall({ look: name, s0: 0, s1: LENGTH })] });
      const verge = layerOf(road);
      const cam = road.toWorld(0, 400, 0, 0);
      verge.update(cam.x, cam.z, null, 0);
      let mesh: InstancedMesh | undefined;
      verge.group.traverse((o) => {
        if (o.name === `verge-${name}`) mesh = o as InstancedMesh;
      });
      expect(mesh?.visible, name).toBe(true);
      const drawM = BARRIER_LOOK_STYLES[name].drawM;
      const m = new Matrix4();
      for (let i = 0; i < (mesh?.count ?? 0); i++) {
        mesh?.getMatrixAt(i, m);
        const p = new Vector3().setFromMatrixPosition(m);
        expect(Math.hypot(p.x - cam.x, p.z - cam.z), name).toBeLessThanOrEqual(drawM + 1e-6);
      }
      expect(mesh?.count, name).toBeLessThan(verge.counts().looks[name]?.panels ?? 0);
    }
  });
});

describe('the shoulder of a tagged road ends in the look its tag names', () => {
  const interstate = () => roadWith({ tags: [tag('interstate')] });

  it('draws a guard rail on both sides along the whole road, with its inner face on the band edge', () => {
    const road = interstate();
    const verge = layerOf(road);
    const seg = BARRIER_LOOK_STYLES.guardrail.segM;
    expect(verge.counts().looks.guardrail?.panels).toBe(2 * (LENGTH / seg));
    verge.update(road.toWorld(0, 20, 0, 0).x, road.toWorld(0, 20, 0, 0).z, null, 0);
    let mesh: InstancedMesh | undefined;
    verge.group.traverse((o) => {
      if (o.name === 'verge-guardrail') mesh = o as InstancedMesh;
    });
    const edge = road.edges[0];
    if (!edge || !mesh) throw new Error('no edge or mesh');
    // Every drawn panel's middle is the band's outer edge plus the look's stand-off, on one side or the other.
    const band = road.vergeAt(0, 10, 'right');
    expect(band.edge).toBe('hard');
    const want = [
      Math.abs(edge.dMax) + band.widthM + BARRIER_LOOK_STYLES.guardrail.outM,
      Math.abs(edge.dMin) + band.widthM + BARRIER_LOOK_STYLES.guardrail.outM,
    ];
    const m = new Matrix4();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const p = new Vector3().setFromMatrixPosition(m);
      // The road runs straight along -z from the origin: lateral d is x with the sign of the frame.
      const d = Math.abs(p.x);
      expect(Math.min(...want.map((w) => Math.abs(w - d)))).toBeLessThan(0.05);
    }
  });

  it('draws nothing on an untagged road with the same shoulder width, so the rail is the tag, not the band', () => {
    const verge = layerOf(roadWith({ tags: [tag('forest')] }));
    expect(verge.counts().looks).toEqual({});
    // A hard edge of another tag (a row-house street) names no edge look: its front is drawn by the scenery.
    expect(layerOf(roadWith({ tags: [tag('row-houses')] })).counts().looks).toEqual({});
  });

  it('draws it only on the side the tag covers', () => {
    const verge = layerOf(roadWith({ tags: [tag('interstate', 'right')] }));
    expect(verge.counts().looks.guardrail?.panels).toBe(LENGTH / 2);
  });

  it('leaves a barrier to its own look: the shoulder rail stops where a barrier stands', () => {
    const walled = layerOf(roadWith({ tags: [tag('interstate')], barriers: [wall()] }));
    expect(walled.counts().looks.guardrail?.panels).toBe(2 * ((LENGTH - 200) / 2));
    expect(walled.counts().looks.concrete?.panels).toBe(2 * 100);
  });

  it("keeps a rail out of a branch ramp's way: no panel within the clearance of a ramp's line, the rest stand", () => {
    // A ramp (a connector road that names no edge look) crosses the right shoulder at s 400..440, from the lane
    // out to 25 m past the road's edge, as the Lake Samish exit does.
    const base = roadWith({ tags: [tag('interstate')] });
    const main = base.edges[0];
    if (!main) throw new Error('no edge');
    const pts = Array.from({ length: 21 }, (_v, i) => base.toWorld(0, 400 + i * 2, 9 + i * 0.8, 0));
    const ramp = {
      ...main,
      index: 1,
      id: 'ramp',
      isConnector: true,
      tags: [],
      count: pts.length,
      x: Float64Array.from(pts.map((p) => p.x)),
      z: Float64Array.from(pts.map((p) => p.z)),
    };
    // The ramp has no ground band of its own in this stub (the layer asks the network for one per edge).
    const noBand = { widthM: 0, surface: 'shoulder', edge: 'hard', dInner: 0, dOuter: 0, derived: true };
    const withRamp = {
      ...base,
      edges: [...base.edges, ramp],
      vergeAt: (edge: number, s: number, side: 'left' | 'right') =>
        edge === 1 ? { ...noBand, side } : base.vergeAt(edge, s, side),
      // Nor has it lanes of its own here: the layer asks where every other edge's lanes lie (it has none),
      // and its frame is the line of its points.
      lanesAt: (edge: number, s: number) => (edge === 1 ? [] : base.lanesAt(edge, s)),
      frameAt: (edge: number, s: number) => {
        if (edge !== 1) return base.frameAt(edge, s);
        const i = Math.max(0, Math.min(pts.length - 2, Math.floor(s / 2)));
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        return { ...base.frameAt(0, 400), x: a.x, z: a.z, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
      },
    } as RoadNetwork;
    const plain = layerOf(base);
    const verge = layerOf(withRamp);
    const kept = verge.counts().looks.guardrail?.panels ?? 0;
    const all = plain.counts().looks.guardrail?.panels ?? 0;
    expect(kept, 'some panels are left out').toBeLessThan(all);
    expect(kept, 'and only the few beside the ramp').toBeGreaterThan(all - 30);
    for (const p of verge.lookPanelPoints('guardrail'))
      for (const q of pts)
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(LOOK_RAMP_CLEAR_M - 1e-6);
    // The panels left out are the right side's: the left rail is whole.
    const leftOf = (v: VergeLayer) =>
      v.lookPanelPoints('guardrail').filter((p) => p.x < base.toWorld(0, 400, 0, 0).x).length;
    expect(leftOf(verge)).toBe(leftOf(plain));
  });
});

describe('the road leaves the solid band of a barrier with a look out', () => {
  it('draws no band for any look, and the full band for the same barrier without one', () => {
    const solid = buildRoadScene(roadWith({ barriers: [wall()] }), look, {
      r: { barriers: [wall()] },
    }).stats.railM;
    expect(solid).toBe(2 * 200);
    for (const name of BARRIER_LOOKS) {
      const road = roadWith({ barriers: [wall({ look: name })] });
      expect(buildRoadScene(road, look, { r: { barriers: [wall({ look: name })] } }).stats.railM, name).toBe(
        0,
      );
    }
  });

  it('draws no band for a barrier whose road tag names a look, and a band on a road whose tag names none', () => {
    const dress = (tags: BakedTag[]) => ({ r: { barriers: [wall()], tags } });
    const tagged = roadWith({ barriers: [wall()], tags: [tag('interstate')] });
    expect(buildRoadScene(tagged, look, dress([tag('interstate')])).stats.railM).toBe(0);
    const plain = roadWith({ barriers: [wall()], tags: [tag('forest')] });
    expect(buildRoadScene(plain, look, dress([tag('forest')])).stats.railM).toBe(2 * 200);
  });

  it('keeps a barrier with a look what its kind says to the sim: a wall stops a tumbling body', () => {
    for (const name of BARRIER_LOOKS) {
      const road = roadWith({ barriers: [wall({ look: name })] });
      expect(road.barrierAt(0, 200, 'left')?.kind, name).toBe('wall');
      expect(road.barrierAt(0, 200, 'right')?.kind, name).toBe('wall');
    }
  });
});
