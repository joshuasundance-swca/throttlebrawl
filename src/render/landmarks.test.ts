// Landmarks (playtest 3, T11.2; the critic's C8, "one landmark system"): a road file's `landmark`
// feature names a node of a landmark kit and the layer draws it where its footprint stands. The
// checks use code-made fixture kits (the real kits come from the Codex batches), so they test the
// rules, not any model: placement against the feature's (s, d), the levels of detail by camera
// distance, one draw call however many landmarks there are, a missing kit or node drawing nothing,
// the Golden Gate's code-made cables meeting the tower tops, and the whole bridge's worst triangle
// count along its deck.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type BakedFeature, type RoadNetwork } from '../road';
import { CAMERA_FAR_M } from './index';
import {
  cablePoints,
  LANDMARK_MID_M,
  LANDMARK_NEAR_M,
  LANDMARK_REFILL_M,
  LandmarkLayer,
  MeshBuilder,
  landmarkFootprints,
  landmarkKitsFor,
  landmarkPlacements,
  SUSPENSION,
} from './landmarks';
import { createFlatLook } from './look';
import { bakeLandmarkKit, parseLandmarkModel, type LandmarkKit, type LandmarkKitId } from './models';

const look = createFlatLook();
/** The examined lines, printed even when the tests pass (console.log is not). */
const stdout = (globalThis as unknown as { process: { stdout: { write(s: string): void } } }).process.stdout;

/** A fixture node: `tris` triangles standing around the origin, `size` m across and up, in `role`. */
function nodeOf(
  name: string,
  tris: number,
  size: number,
  extras: Record<string, number> = {},
  role = 'steel',
): Mesh {
  const pos: number[] = [];
  for (let i = 0; i < tris; i++) {
    const y = (i / tris) * size;
    pos.push(-size / 2, y, 0, size / 2, y, 0, 0, y + size / tris, size / 4);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const mat = new MeshBasicMaterial({ color: '#808080' });
  mat.name = role;
  const mesh = new Mesh(g, mat);
  mesh.name = name;
  Object.assign(mesh.userData, extras);
  return mesh;
}

const sceneOf = (nodes: Object3D[]): Group => {
  const g = new Group();
  for (const n of nodes) g.add(n);
  return g;
};

/** The Golden Gate fixture kit, with the triangle counts and extras of the Codex brief (CX3). */
function ggKit(): LandmarkKit {
  return bakeLandmarkKit(
    'golden-gate',
    sceneOf([
      nodeOf('gg_tower_lod0', 900, 227, { top_m: 227, cable_saddle_x_m: 11.5 }, 'bridge_paint'),
      nodeOf('gg_tower_lod1', 120, 227),
      nodeOf('gg_bay_lod0', 48, 4, { bay_m: 15.24 }),
      nodeOf('gg_bay_lod1', 24, 4, { bay_m: 15.24 }),
      nodeOf('gg_anchorage', 300, 30, { cable_entry_m: 6 }),
    ]),
  );
}

function sfKit(): LandmarkKit {
  return bakeLandmarkKit(
    'sf-landmarks',
    sceneOf([nodeOf('coit_tower', 900, 64), nodeOf('far_coit_tower', 60, 64), nodeOf('toll_gantry', 500, 9)]),
  );
}

const kitsOf = (...kits: LandmarkKit[]): Map<LandmarkKitId, LandmarkKit> =>
  new Map(kits.map((k) => [k.id, k]));

const lm = (id: string, model: string, over: Partial<BakedFeature> = {}): BakedFeature => ({
  kind: 'landmark',
  id,
  s0: 300,
  s1: 320,
  d0: 20,
  d1: 40,
  params: { model },
  ...over,
});

/** A straight road of `lengthM` with the given landmark features (and a deck at 67 m when asked). */
function roadWith(features: BakedFeature[], lengthM = 3000, grade = 0): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'r', lengthM, kappa: 0, grade }]);
  const road = bundle.roads[0];
  if (!road) throw new Error('no road');
  return createRoadNetwork({ network: bundle.network, roads: [{ ...road, features }] });
}

const bridge = (over: Record<string, unknown> = {}): BakedFeature => ({
  kind: 'landmark',
  id: 'gg',
  s0: 200,
  s1: 200 + 2 * SUSPENSION.sideSpanM + 1280,
  d0: -20,
  d1: 20,
  params: { model: 'models/landmarks/golden-gate#gg_bridge', overRoad: true, baseY: 0, ...over },
});

describe('landmark models are named by kit and node', () => {
  it('reads an asset id or the short kit name, and refuses what it does not know', () => {
    expect(parseLandmarkModel('models/landmarks/golden-gate#gg_bridge')).toEqual({
      kit: 'golden-gate',
      node: 'gg_bridge',
    });
    expect(parseLandmarkModel('sf-landmarks#coit_tower')).toEqual({
      kit: 'sf-landmarks',
      node: 'coit_tower',
    });
    expect(parseLandmarkModel('models/landmarks/not-a-kit#x')).toBeNull();
    expect(parseLandmarkModel('golden-gate#')).toBeNull();
    expect(parseLandmarkModel('golden-gate')).toBeNull();
    expect(parseLandmarkModel(null)).toBeNull();
  });

  it('bakes every named root of a kit with its numeric extras', () => {
    const kit = ggKit();
    expect([...kit.nodes.keys()].sort()).toEqual([
      'gg_anchorage',
      'gg_bay_lod0',
      'gg_bay_lod1',
      'gg_tower_lod0',
      'gg_tower_lod1',
    ]);
    expect(kit.nodes.get('gg_tower_lod0')?.extras).toEqual({ top_m: 227, cable_saddle_x_m: 11.5 });
    expect(kit.nodes.get('gg_bay_lod0')?.geometry.getAttribute('position').count).toBe(48 * 3);
  });
});

describe('a landmark stands where its footprint is on the road', () => {
  it('puts the node origin at the footprint centre (s, d) to 0.1 m, on the road surface, turned by yawDeg', () => {
    const road = roadWith(
      [
        lm('a', 'sf-landmarks#coit_tower'),
        lm('b', 'sf-landmarks#toll_gantry', {
          s0: 900,
          s1: 920,
          params: { model: 'sf-landmarks#toll_gantry', yawDeg: 90 },
        }),
      ],
      3000,
      0.02,
    );
    const [a, b] = landmarkPlacements(road);
    if (!a || !b) throw new Error('two placements');
    const want = road.toWorld(0, 310, 30, 0);
    expect(Math.hypot(a.x - want.x, a.z - want.z)).toBeLessThan(0.1);
    expect(a.y).toBeCloseTo(want.y, 6);
    expect(a.yaw).toBeCloseTo(Math.atan2(road.frameAt(0, 310).tx, road.frameAt(0, 310).tz), 9);
    expect(b.yaw - Math.atan2(road.frameAt(0, 910).tx, road.frameAt(0, 910).tz)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('stands a landmark at params.baseY when it says so (a tower rising from the water)', () => {
    const road = roadWith(
      [lm('a', 'sf-landmarks#coit_tower', { params: { model: 'sf-landmarks#coit_tower', baseY: 0 } })],
      3000,
      0.05,
    );
    expect(landmarkPlacements(road)[0]?.y).toBe(0);
    expect(road.toWorld(0, 310, 30, 0).y).toBeGreaterThan(10);
  });

  it('leaves out a feature that names no model or an unknown kit, and lists only the kits it needs', () => {
    const road = roadWith([
      lm('a', 'sf-landmarks#coit_tower'),
      lm('b', 'nonsense#x'),
      { ...lm('c', ''), params: {} },
    ]);
    expect(landmarkPlacements(road).map((p) => p.feature.id)).toEqual(['a']);
    expect(landmarkKitsFor(road)).toEqual(['sf-landmarks']);
  });
});

describe('the footprint keeps the roadside off, unless the structure spans the road', () => {
  it('covers each corner of a beside-the-road footprint with a circle, and none for an overRoad structure', () => {
    const road = roadWith([
      lm('a', 'sf-landmarks#coit_tower', { s0: 400, s1: 460, d0: 12, d1: 30 }),
      lm('b', 'sf-landmarks#toll_gantry', {
        s0: 900,
        s1: 910,
        d0: -10,
        d1: 10,
        params: { model: 'sf-landmarks#toll_gantry', overRoad: true },
      }),
    ]);
    const circles = landmarkFootprints(road);
    expect(circles.length).toBeGreaterThan(0);
    for (const [s, d] of [
      [400, 12],
      [400, 30],
      [460, 12],
      [460, 30],
      [430, 21],
    ] as const) {
      const p = road.toWorld(0, s, d, 0);
      expect(
        circles.some((c) => Math.hypot(c.x - p.x, c.z - p.z) <= c.r + 1e-6),
        `(${s}, ${d})`,
      ).toBe(true);
    }
    const gantry = road.toWorld(0, 905, 0, 0);
    expect(circles.some((c) => Math.hypot(c.x - gantry.x, c.z - gantry.z) < 20)).toBe(false);
  });
});

describe('levels of detail are draw ranges of one mesh', () => {
  const road = roadWith([
    lm('a', 'sf-landmarks#coit_tower'),
    lm('b', 'sf-landmarks#toll_gantry', { s0: 1500, s1: 1520 }),
  ]);
  const camera = (s: number): { x: number; z: number } => {
    const p = road.toWorld(0, s, 0, 0);
    return { x: p.x, z: p.z };
  };

  it('draws the near node close, the far node past farM, and nothing past the mid reach', () => {
    const layer = new LandmarkLayer(kitsOf(sfKit()), look, { road });
    expect(layer.levels()[0]?.map(([, tris]) => tris)).toEqual([900, 60]);
    // The gantry has one node: it holds that node out to the mid reach.
    expect(layer.levels()[1]?.map(([, tris]) => tris)).toEqual([500]);
    const at = (s: number, ahead = 0) => {
      const c = camera(s);
      layer.update(c.x, c.z - ahead);
      return layer.counts().trianglesDrawn;
    };
    // 300 m from the tower (s 310) and 1,200 m from the gantry (s 1510): the tower, near.
    expect(at(10)).toBe(900);
    // 700 m from the tower (past its farM of 400) and 500 m from the gantry: far tower and the gantry.
    expect(at(1010)).toBe(60 + 500);
    // Kilometres from both: nothing, and no draw call.
    expect(at(10, 6000)).toBe(0);
    expect(layer.counts().drawCalls).toBe(0);
    layer.dispose();
  });

  it('keeps one mesh and one draw call however many landmarks there are, and refills only after the camera moves', () => {
    const many = roadWith(
      Array.from({ length: 8 }, (_, i) =>
        lm(`l${i}`, 'sf-landmarks#coit_tower', { s0: 300 + i * 40, s1: 320 + i * 40 }),
      ),
    );
    const layer = new LandmarkLayer(kitsOf(sfKit()), look, { road: many });
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    const p = many.toWorld(0, 100, 0, 0);
    layer.update(p.x, p.z);
    expect(layer.counts().drawCalls).toBe(1);
    expect(layer.counts().placed).toBe(8);
    const before = layer.counts().trianglesDrawn;
    layer.update(p.x, p.z - 5 + LANDMARK_REFILL_M / 4);
    expect(layer.counts().trianglesDrawn).toBe(before);
  });

  it('reaches past the camera far plane, so a landmark never pops out inside the view', () => {
    expect(LANDMARK_MID_M).toBeGreaterThan(CAMERA_FAR_M);
    expect(LANDMARK_NEAR_M).toBeLessThan(LANDMARK_MID_M);
  });
});

describe('a landmark whose model is missing draws nothing', () => {
  it('skips a missing kit or a missing node, never throws, and adds no mesh', () => {
    const road = roadWith([lm('a', 'golden-gate#gg_tower_lod0'), lm('b', 'sf-landmarks#no_such_node')]);
    const layer = new LandmarkLayer(kitsOf(sfKit()), look, { road });
    expect(layer.counts()).toMatchObject({ placed: 0, skipped: 2, vertices: 0, drawCalls: 0 });
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(0);
    layer.update(0, 0);
    expect(layer.counts().trianglesDrawn).toBe(0);
  });
});

describe('the Golden Gate is composed in code from the kit', () => {
  const road = roadWith([bridge()], 2900);
  const sT = [200 + SUSPENSION.sideSpanM, 200 + SUSPENSION.sideSpanM + 1280];

  it('draws the whole bridge as one mesh: towers, bays, anchorages and cables', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    expect(layer.counts().placed).toBe(1);
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    const c = road.toWorld(0, 1000, 0, 0);
    layer.update(c.x, c.z);
    expect(layer.counts().drawCalls).toBe(1);
    // 2 towers + floor(1966 / 15.24) bays + 2 anchorages + the cables' pieces.
    expect(layer.counts().pieces).toBeGreaterThan(2 + 129 + 2);
  });

  it('hangs each cable from the tower top: a tube ring is centred on the saddle, to 0.1 m', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    const c = road.toWorld(0, sT[0] as number, 0, 0);
    layer.update(c.x, c.z);
    const mesh = layer.group.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const saddles = [-1, 1].map((sigma) => {
      // Tower 0's frame: +Z along the road (+s), +X across, the origin at the waterline.
      const fr = road.frameAt(0, sT[0] as number);
      return new Vector3(c.x + sigma * 11.5 * fr.tz, 227, c.z - sigma * 11.5 * fr.tx);
    });
    // Each side span lands in its anchorage: the entry is `cable_entry_m` (6 m) over the deck top, on
    // the same side of the road at either end (the far anchorage is turned to face the span).
    const entries = [200, 2166].flatMap((s) => {
      const p = road.toWorld(0, s, 0, 0);
      const fr = road.frameAt(0, s);
      return [-1, 1].map((sigma) => new Vector3(p.x + sigma * 11.5 * fr.tz, 6, p.z - sigma * 11.5 * fr.tx));
    });
    for (const saddle of [...saddles, ...entries]) {
      // Every ring of a tube is a circle of `radius` round its centre, so the vertices exactly one
      // radius from the point are the rings centred on it (each ring vertex sits in several
      // triangles, so there are more than `sides`). Float32 positions here are good to a centimetre.
      let onRing = 0;
      for (let i = 0; i < pos.count; i++) {
        const v = new Vector3().fromBufferAttribute(pos, i);
        if (Math.abs(v.distanceTo(saddle) - SUSPENSION.radiusNear) < 0.02) onRing++;
      }
      expect(onRing).toBeGreaterThanOrEqual(2 * SUSPENSION.sides);
    }
  });

  it('winds every cable triangle outward, so the front-face material shows the tube', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    const c = road.toWorld(0, 1000, 0, 0);
    layer.update(c.x, c.z);
    const mesh = layer.group.children[0] as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    const nrm = mesh.geometry.getAttribute('normal');
    const cable = SUSPENSION.radiusNear;
    let checked = 0;
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(pos, i);
      const b = new Vector3().fromBufferAttribute(pos, i + 1);
      const d = new Vector3().fromBufferAttribute(pos, i + 2);
      const n = new Vector3().fromBufferAttribute(nrm, i);
      const face = b.clone().sub(a).cross(d.clone().sub(a));
      // Cables are the only parts with unit normals and a 0.5 m tube; the fixture nodes are flat.
      if (a.distanceTo(b) > cable * 3 || face.lengthSq() < 1e-12) continue;
      if (face.dot(n) <= 0) throw new Error(`triangle ${i / 3} faces inward`);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('hangs a cable as a parabola: the ends are fixed, the middle sags by the given depth', () => {
    const a = new Vector3(0, 227, 0);
    const b = new Vector3(0, 227, 1280);
    const pts = cablePoints(a, b, 144, 64);
    expect(pts).toHaveLength(65);
    expect(pts[0]?.distanceTo(a)).toBeLessThan(1e-9);
    expect(pts[64]?.distanceTo(b)).toBeLessThan(1e-9);
    expect(pts[32]?.y).toBeCloseTo(227 - 144, 9);
  });

  it('repaints the bridge paint from the palette (the kit role and the cables)', () => {
    const plain = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    const painted = new LandmarkLayer(kitsOf(ggKit()), look, { road, palette: { bridgePaint: '#00ff00' } });
    const cols = (l: LandmarkLayer) => {
      const c = road.toWorld(0, 1000, 0, 0);
      l.update(c.x, c.z);
      return ((l.group.children[0] as Mesh).geometry.getAttribute('color').array as Float32Array).slice();
    };
    const a = cols(plain);
    const b = cols(painted);
    const greens = (arr: Float32Array) => {
      let n = 0;
      for (let i = 0; i < arr.length; i += 3) if (arr[i] === 0 && arr[i + 1] === 1 && arr[i + 2] === 0) n++;
      return n;
    };
    expect(greens(a)).toBe(0);
    // The towers (role bridge_paint) and every cable vertex turn green.
    expect(greens(b)).toBeGreaterThan(2 * 900 * 3);
  });

  it('the worst view along the deck stays inside the triangle budget', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    let worst = 0;
    let worstAt = 0;
    let bestCalls = 1;
    for (let s = 0; s <= 2800; s += 20) {
      const c = road.toWorld(0, s, 0, 0);
      layer.update(c.x, c.z);
      const t = layer.counts().trianglesDrawn;
      if (t > worst) {
        worst = t;
        worstAt = s;
      }
      bestCalls = Math.max(bestCalls, layer.counts().drawCalls);
    }
    stdout.write(
      `[examined] Golden Gate fixture: worst view ${worst} triangles at s ${worstAt}, ${layer.counts().pieces} pieces, ${layer.counts().vertices} vertices\n`,
    );
    // The assets plan's worst case is 9,060 triangles (tower 900/120, bay 48/24, anchorage 300, with
    // 64-segment cables); this build's cables are 6-sided tubes, so a margin on top of it. Playtest 4's
    // suspender ropes (3-sided, 6 triangles each, drawn to 500 m) add about 400 in the worst view, so the
    // cap is the plan's 9,060 plus 500 for the ropes; the plan's own cap for a landmark view is 18,000.
    expect(worst).toBeLessThanOrEqual(9060 + 500);
    expect(bestCalls).toBe(1);
  });
});

// Playtest 4, P1 (the wave C check: "no suspender ropes"): the Golden Gate's main cables hung free. The
// bridge now hangs a rope from each cable to the deck's edge at every bay, in the same one mesh.
describe('the Golden Gate hangs suspender ropes from its cables', () => {
  const road = roadWith([bridge()], 2900);
  const sT0 = 200 + SUSPENSION.sideSpanM;
  const sT1 = sT0 + 1280;

  /** The ropes of a layer's mesh: the vertical, thin tubes (a rope's triangles span metres up and almost nothing across). */
  function ropesOf(layer: LandmarkLayer): { x: number; z: number; bottom: number; top: number }[] {
    const pos = (layer.group.children[0] as Mesh | undefined)?.geometry.getAttribute('position');
    if (!pos) return [];
    const pts: Vector3[] = [];
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const v = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k));
      const ys = v.map((p) => p.y);
      const xs = v.map((p) => p.x);
      const zs = v.map((p) => p.z);
      const across = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      if (
        Math.max(...ys) - Math.min(...ys) >= SUSPENSION.ropeMinM &&
        across <= 2 * SUSPENSION.ropeRadiusNear + 0.02
      )
        pts.push(...v);
    }
    const groups: Vector3[][] = [];
    for (const p of pts) {
      const g = groups.find((q) => Math.hypot((q[0] as Vector3).x - p.x, (q[0] as Vector3).z - p.z) < 0.4);
      if (g) g.push(p);
      else groups.push([p]);
    }
    return groups.map((g) => ({
      x: g.reduce((a, p) => a + p.x, 0) / g.length,
      z: g.reduce((a, p) => a + p.z, 0) / g.length,
      bottom: Math.min(...g.map((p) => p.y)),
      top: Math.max(...g.map((p) => p.y)),
    }));
  }

  it('hangs a rope from each cable at each bay of the main span, on the cable and over the deck edge', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    const ropes = ropesOf(layer);
    const origin = road.toWorld(0, 1000, 0, 0);
    const fr = road.frameAt(0, 1000);
    let main = 0;
    let worstTop = 0;
    let worstFoot = 0;
    let worstSide = 0;
    for (const r of ropes) {
      // Along the road (s) and across it, from the road's own frame at the bridge's middle.
      const dx = r.x - origin.x;
      const dz = r.z - origin.z;
      const s = 1000 + dx * fr.tx + dz * fr.tz;
      const across = dx * fr.tz - dz * fr.tx;
      worstSide = Math.max(worstSide, Math.abs(Math.abs(across) - 11.5));
      worstFoot = Math.max(worstFoot, Math.abs(r.bottom - SUSPENSION.ropeFootM));
      if (s > sT0 + SUSPENSION.ropeTowerClearM && s < sT1 - SUSPENSION.ropeTowerClearM) {
        main++;
        // The main cable: a parabola from saddle to saddle (227 m), its lowest point 3 m over a deck at y 0.
        const u = (s - sT0) / 1280;
        const cableY = 227 - (227 - SUSPENSION.midClearM) * 4 * u * (1 - u);
        worstTop = Math.max(worstTop, Math.abs(r.top - cableY));
      }
    }
    stdout.write(
      `[examined] Golden Gate fixture: ${ropes.length} suspender ropes, ${main} on the main span; worst top off its cable ${worstTop.toFixed(3)} m, foot off the deck edge ${worstFoot.toFixed(3)} m, side off the cable ${worstSide.toFixed(3)} m\n`,
    );
    // Two cables, a rope every bay (15.24 m), less the stretch the towers' legs keep clear.
    expect(main).toBeGreaterThanOrEqual(2 * Math.floor((1280 - 2 * SUSPENSION.ropeTowerClearM) / 15.24) - 4);
    expect(worstTop).toBeLessThan(0.05);
    expect(worstFoot).toBeLessThan(0.05);
    expect(worstSide).toBeLessThan(0.05);
  });

  it('costs no draw call (the ropes are in the cables mesh), and a kit with no bays draws none (the control)', () => {
    const layer = new LandmarkLayer(kitsOf(ggKit()), look, { road });
    let meshes = 0;
    layer.group.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
    const c = road.toWorld(0, 1000, 0, 0);
    layer.update(c.x, c.z);
    expect(layer.counts().drawCalls).toBe(1);
    const bare = bakeLandmarkKit(
      'golden-gate',
      sceneOf([
        nodeOf('gg_tower_lod0', 900, 227, { top_m: 227, cable_saddle_x_m: 11.5 }, 'bridge_paint'),
        nodeOf('gg_anchorage', 300, 30, { cable_entry_m: 6 }),
      ]),
    );
    const without = new LandmarkLayer(kitsOf(bare), look, { road });
    expect(ropesOf(without)).toHaveLength(0);
    expect(ropesOf(layer).length).toBeGreaterThan(100);
  });
});

// The code-made shapes (the rain cloud's blobs and its rain's streaks) are drawn by the lit, front-face
// material, so every triangle must face outward from its own shape.
describe('the code-made blobs and boxes face outward', () => {
  const around = (b: MeshBuilder, centre: Vector3, expected: number) => {
    const pos = b.pos;
    const nrm = b.nrm;
    expect(pos.length / 9).toBe(expected);
    for (let i = 0; i < pos.length; i += 9) {
      const a = new Vector3(pos[i], pos[i + 1], pos[i + 2]);
      const bb = new Vector3(pos[i + 3], pos[i + 4], pos[i + 5]);
      const c = new Vector3(pos[i + 6], pos[i + 7], pos[i + 8]);
      const n = new Vector3(nrm[i], nrm[i + 1], nrm[i + 2]);
      const face = bb.clone().sub(a).cross(c.clone().sub(a)).normalize();
      expect(face.distanceTo(n), `triangle ${i / 9}: the stored normal is the face's`).toBeLessThan(1e-6);
      const middle = a.clone().add(bb).add(c).divideScalar(3);
      expect(n.dot(middle.sub(centre)), `triangle ${i / 9} faces out`).toBeGreaterThan(0);
    }
  };
  it('winds a box and a flattened blob counter-clockwise from outside', () => {
    const box = new MeshBuilder();
    box.addBox(new Vector3(-1, 0, -2), new Vector3(3, 5, 4), new Color('#ffffff'));
    around(box, new Vector3(1, 2.5, 1), 12);
    const blob = new MeshBuilder();
    blob.addBlob(new Vector3(10, 20, -5), 8, 2, 5, new Color('#808080'));
    around(blob, new Vector3(10, 20, -5), 20);
  });
});

// Playtest 4, B7: Portland's truss bays and lift span run from their origin along +Z (the kit's `bay_m`
// extra says how far), while a tower stands about its origin. A landmark feature is placed by its middle,
// so a node with a `bay_m` stands with its middle on the feature's, and its length fills the footprint
// the road names, from s0 to s1, end to end with the bay beside it.
describe('a bay stands by its middle, so its footprint is the road its length fills', () => {
  /** A strip of road deck `lengthM` long from the origin along +Z, `widthM` across, as a bay is modelled. */
  function bayNode(name: string, lengthM: number, extras: Record<string, number>): Mesh {
    const g = new BufferGeometry();
    const w = 9;
    g.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([-w, 8, 0, w, 8, 0, w, 8, lengthM, -w, 8, 0, w, 8, lengthM, -w, 8, lengthM]),
        3,
      ),
    );
    const mesh = new Mesh(g, Object.assign(new MeshBasicMaterial({ color: '#808080' }), { name: 'steel' }));
    mesh.name = name;
    Object.assign(mesh.userData, extras);
    return mesh;
  }
  const pdxKit = (): LandmarkKit =>
    bakeLandmarkKit(
      'pdx-landmarks',
      sceneOf([bayNode('pdx_truss_bay', 40, { bay_m: 40 }), bayNode('pdx_stub', 40, {})]),
    );

  /** The along-the-road range of every vertex the layer draws for the landmark, s, m. */
  function drawnRange(road: RoadNetwork, node: string, s0: number, s1: number): [number, number] {
    const layer = new LandmarkLayer(kitsOf(pdxKit()), look, { road });
    const c = road.toWorld(0, (s0 + s1) / 2, 0, 0);
    layer.update(c.x, c.z);
    const mesh = layer.group.children.find((o) => o.name === 'landmarks') as Mesh;
    const pos = mesh.geometry.getAttribute('position');
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const s = road.project(pos.getX(i), pos.getZ(i), 0).s;
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
    expect(node).toBeTruthy();
    return [lo, hi];
  }
  const bayFeature = (id: string, node: string, s0: number, s1: number): BakedFeature => ({
    kind: 'landmark',
    id,
    s0,
    s1,
    d0: -12,
    d1: 12,
    params: { model: `pdx-landmarks#${node}`, overRoad: true },
  });

  it('fills the footprint from s0 to s1 for a node that says bay_m, to 0.1 m', () => {
    const road = roadWith([bayFeature('bay', 'pdx_truss_bay', 600, 640)]);
    const [lo, hi] = drawnRange(road, 'pdx_truss_bay', 600, 640);
    stdout.write(`[examined] a 40 m bay on s 600 to 640 draws from s ${lo.toFixed(2)} to ${hi.toFixed(2)}\n`);
    expect(lo).toBeGreaterThan(600 - 0.1);
    expect(lo).toBeLessThan(600 + 0.1);
    expect(hi).toBeGreaterThan(640 - 0.1);
    expect(hi).toBeLessThan(640 + 0.1);
  });

  it('keeps the origin at the middle for a node without bay_m (the control: a tower is not shifted)', () => {
    const road = roadWith([bayFeature('stub', 'pdx_stub', 600, 640)]);
    const [lo, hi] = drawnRange(road, 'pdx_stub', 600, 640);
    expect(lo).toBeGreaterThan(620 - 0.1);
    expect(lo).toBeLessThan(620 + 0.1);
    expect(hi).toBeGreaterThan(660 - 0.1);
    expect(hi).toBeLessThan(660 + 0.1);
  });
});
