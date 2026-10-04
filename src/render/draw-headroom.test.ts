// Run W-T's draw-call headroom: the live check found the busiest scenes at 109 of the 120 draw calls
// the perf check allows (Keys seed 5, a roadwork beside a speed trap: 23 event props, three signs).
// Three cuts, each drawing the same thing in fewer calls:
// - the road events' props and the smashables are batched (prop-batch.ts): the props standing still
//   in one mesh, the moving ones in another, every sign panel in one mesh over a shared atlas;
// - the road leaves its fine detail (markings, dashes, thin posts) out of chunks past 300 m, where
//   a 0.15 m line is a fraction of a pixel.
// Draw calls are counted the way the renderer issues them: one per visible mesh with something in
// it (an instanced mesh counts once, however many instances).
import {
  Frustum,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Vector3,
  type BufferAttribute,
  type Object3D,
} from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import type {
  EntitySnapshot,
  PropKind,
  PropSnapshot,
  SimSnapshot,
  SimTrafficTypeDef,
  SmashableSnapshot,
} from '../sim/api';
import { EventProps } from './event-props';
import { mergeBoxes } from './geometry';
import { createFlatLook } from './look';
import { PropBatch } from './prop-batch';
import { buildRoadScene, chunkDistance, ROAD_FINE_DRAW_M } from './road-mesh';
import { Smashables } from './smashables';
import { EntityViews } from './views';

const look = createFlatLook();

function prop(id: number, kind: PropKind, extra: Partial<PropSnapshot> = {}): PropSnapshot {
  return {
    id,
    kind,
    variant: '',
    label: '',
    piece: 'test:piece',
    x: 2 + (id % 3),
    y: 0,
    z: -40 - id * 4,
    heading: 0.1,
    tilt: 0,
    moving: false,
    ...extra,
  };
}

const snap = (props: PropSnapshot[], smashables: SmashableSnapshot[] = []): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities: [],
  race: { over: false, routeLength: 1000, finishOrder: [] },
  props,
  smashables,
});

/** Draw calls under a root: every visible mesh with something to draw. */
function draws(root: Object3D): number {
  let n = 0;
  const walk = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof InstancedMesh) n += o.count > 0 ? 1 : 0;
    else if (o instanceof Mesh) n++;
    for (const c of o.children) walk(c);
  };
  walk(root);
  return n;
}

/**
 * The W-T check's busiest scene, as its scan recorded it (scratch wt-check keys5, tick 4555): three
 * signs (the speed trap's, the roadwork's, the deputies' END OF JURISDICTION), two radar guns, the
 * radar cop and the flagger, fourteen cones, a barricade and an arrow board.
 */
function roadworkBesideSpeedTrap(): PropSnapshot[] {
  let id = 0;
  const next = () => ++id;
  return [
    prop(next(), 'sign', { variant: 'speed-trap', label: 'RADAR AHEAD. The radar is bored.' }),
    prop(next(), 'sign', { variant: 'roadwork', label: 'ROAD WORK AHEAD. Since 1987.' }),
    prop(next(), 'sign', {
      variant: 'jurisdiction',
      label: 'END OF JURISDICTION. Keys County Deputies thank you for leaving.',
    }),
    prop(next(), 'radar'),
    prop(next(), 'radar'),
    prop(next(), 'person', { variant: 'cop-radar' }),
    prop(next(), 'person', { variant: 'flagger' }),
    ...Array.from({ length: 14 }, () => prop(next(), 'cone')),
    prop(next(), 'barricade'),
    prop(next(), 'arrowBoard'),
  ];
}

// A stand-in canvas: panels are painted only where there is a DOM.
beforeEach(() => {
  const own: Record<string, unknown> = { measureText: (t: string) => ({ width: t.length * 12 }) };
  const ctx = new Proxy(own, {
    get: (target, key): unknown => (typeof key === 'string' && key in target ? target[key] : () => undefined),
    set: () => true,
  });
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('the road events draw in a few calls (run W-T, the draw-call headroom)', () => {
  it("the check's busiest scene, 23 props and 3 signs, is 3 draw calls (it was 11)", () => {
    const e = new EventProps(look);
    const props = roadworkBesideSpeedTrap();
    expect(props).toHaveLength(23);
    e.sync(snap(props), 0);
    // The props standing still, the flagger's waving arm, and the three sign panels.
    expect(draws(e.root)).toBe(3);
    expect(e.counts().total).toBe(23);
    expect(e.counts().signs).toHaveLength(3);
  });

  it('a parade (floats, marchers, the balloon, flares) stays at four calls however many props', () => {
    const e = new EventProps(look);
    const props: PropSnapshot[] = [
      prop(1, 'sign', { variant: 'parade', label: 'PARADE AHEAD. Wave back.' }),
      ...Array.from({ length: 4 }, (_, i) =>
        prop(10 + i, 'floatDecor', { variant: `keys-${i}`, moving: true }),
      ),
      ...Array.from({ length: 8 }, (_, i) => prop(20 + i, 'person', { variant: 'marcher-keys' })),
      prop(30, 'inflatable'),
      ...Array.from({ length: 6 }, (_, i) => prop(40 + i, 'flare')),
      ...Array.from({ length: 10 }, (_, i) => prop(50 + i, 'cone')),
    ];
    e.sync(snap(props), 0);
    // Still: the post, the marchers, the flare sticks and cones. Moving: the floats' dressing, the
    // marchers' arms and the balloon. The flares' glow (unlit). The sign's panel.
    expect(draws(e.root)).toBe(4);
  });

  it('what stands still is written once, not every frame; what moves is rewritten', () => {
    const e = new EventProps(look);
    const props = roadworkBesideSpeedTrap();
    const batch = (name: string) =>
      e.root.children.find((o): o is Mesh => o instanceof Mesh && o.name === name) ?? null;
    e.sync(snap(props), 0);
    const still = batch('event-props-still');
    const moving = batch('event-props-moving');
    expect(still?.visible).toBe(true);
    expect(moving?.visible).toBe(true);
    const stillPositions = () => (still?.geometry.getAttribute('position').array as Float32Array).slice();
    const before = stillPositions();
    const version = (m: Mesh | null) =>
      (m?.geometry.getAttribute('position') as BufferAttribute | undefined)?.version ?? -1;
    const movingVersion = () => version(moving);
    const stillVersion = () => version(still);
    const sv = stillVersion();
    const mv = movingVersion();
    for (let f = 1; f <= 5; f++) e.sync(snap(props), f / 60);
    expect(stillVersion()).toBe(sv);
    expect(stillPositions()).toEqual(before);
    // The flagger's arm waves: its batch is rewritten each frame.
    expect(movingVersion()).toBeGreaterThanOrEqual(mv + 5);
    // A cone knocked over is a change: the still batch is rewritten once.
    const knocked = props.map((p) => (p.id === 10 ? { ...p, tilt: 1.5 } : p));
    e.sync(snap(knocked), 0.2);
    expect(stillVersion()).toBe(sv + 1);
  });

  it('hides everything once no piece is live', () => {
    const e = new EventProps(look);
    e.sync(snap(roadworkBesideSpeedTrap()), 0);
    e.sync(snap([]), 0.1);
    expect(draws(e.root)).toBe(0);
  });

  it('gives each sign its own cell of the atlas, and frees it when the sign leaves', () => {
    const e = new EventProps(look);
    const signs = ['A', 'B', 'C'].map((label, i) => prop(i + 1, 'sign', { variant: 'roadwork', label }));
    e.sync(snap(signs), 0);
    const panels = e.root.children.find((o): o is Mesh => o instanceof Mesh && o.name === 'event-panels');
    if (!panels) throw new Error('no sign panels');
    const uv = panels.geometry.getAttribute('uv');
    expect(uv.count).toBe(12);
    const cells = new Set<string>();
    for (let q = 0; q < 3; q++) {
      const us = [0, 1, 2, 3].map((k) => uv.getX(q * 4 + k));
      const vs = [0, 1, 2, 3].map((k) => uv.getY(q * 4 + k));
      // A cell is a quarter of the atlas wide and half of it tall, less its inset.
      expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(0.25, 1);
      expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(0.5, 1);
      cells.add(`${Math.min(...us).toFixed(2)},${Math.min(...vs).toFixed(2)}`);
    }
    expect(cells.size).toBe(3);
    // Nine more signs than the atlas holds: the last draw on their own, every word still drawn.
    const many = Array.from({ length: 10 }, (_, i) =>
      prop(i + 1, 'sign', { variant: 'serial', label: `LINE ${i}` }),
    );
    e.sync(snap(many), 0.1);
    expect(e.counts().signs).toHaveLength(10);
    // The still batch (posts), the atlas's eight panels in one mesh, and two signs of their own.
    expect(draws(e.root)).toBe(1 + 1 + 2);
  });

  it('stands each panel where its sign is, facing back along the road, its post behind it', () => {
    const e = new EventProps(look);
    const sign = prop(1, 'sign', {
      variant: 'roadwork',
      label: 'ROAD WORK AHEAD',
      x: 10,
      z: -100,
      heading: 0,
    });
    e.sync(snap([sign]), 0);
    const panels = e.root.children.find((o): o is Mesh => o instanceof Mesh && o.name === 'event-panels');
    const still = e.root.children.find((o): o is Mesh => o instanceof Mesh && o.name === 'event-props-still');
    if (!panels || !still) throw new Error('missing meshes');
    panels.geometry.computeBoundingBox();
    const box = panels.geometry.boundingBox;
    // A 3 m panel from 2.2 m up, centred on the sign, in the plane z = -100, facing +z.
    expect(box?.min.x).toBeCloseTo(8.5, 5);
    expect(box?.max.x).toBeCloseTo(11.5, 5);
    expect(box?.min.y).toBeCloseTo(2.2, 5);
    expect(box?.max.y).toBeCloseTo(5.2, 5);
    expect(box?.min.z).toBeCloseTo(-100, 5);
    expect(panels.geometry.getAttribute('normal').getZ(0)).toBeCloseTo(1, 5);
    // The batch's own bounds (its buffer has room past its items, so never recompute them whole).
    expect(still.geometry.boundingBox?.max.z ?? 0).toBeLessThan(-100);
  });
});

describe('a prop batch draws exactly what the instances drew', () => {
  it('places every vertex as the instance matrix did, with its colour and a turned normal', () => {
    const geo = mergeBoxes([
      { size: [1, 2, 0.5], at: [0, 1, 0], color: '#ff6a13' },
      { size: [0.3, 0.3, 0.3], at: [0.2, 2.2, -0.1], color: '#f4f4f0', rotX: 0.4 },
    ]);
    const batch = new PropBatch(look.material('prop', { vertexColors: true }), 'test');
    const m1 = new Matrix4().makeRotationY(0.7).setPosition(5, 0, -20);
    const m2 = new Matrix4()
      .makeRotationX(1.2)
      .scale(new Vector3(1.7, 1.7, 1.7))
      .setPosition(-3, 0.5, -60);
    batch.begin();
    batch.add(geo, m1);
    batch.add(geo, m2);
    batch.end();
    const out = batch.mesh.geometry;
    const pos = out.getAttribute('position');
    const nrm = out.getAttribute('normal');
    const col = out.getAttribute('color');
    const src = geo.getAttribute('position');
    const n = src.count;
    for (const [k, m] of [m1, m2].entries()) {
      for (let i = 0; i < n; i += 5) {
        const want = new Vector3().fromBufferAttribute(src, i).applyMatrix4(m);
        expect(pos.getX(k * n + i)).toBeCloseTo(want.x, 4);
        expect(pos.getY(k * n + i)).toBeCloseTo(want.y, 4);
        expect(pos.getZ(k * n + i)).toBeCloseTo(want.z, 4);
        const wantN = new Vector3().fromBufferAttribute(geo.getAttribute('normal'), i).transformDirection(m);
        expect(nrm.getX(k * n + i)).toBeCloseTo(wantN.x, 4);
        expect(nrm.getY(k * n + i)).toBeCloseTo(wantN.y, 4);
        expect(nrm.getZ(k * n + i)).toBeCloseTo(wantN.z, 4);
        expect(col.getX(k * n + i)).toBeCloseTo(geo.getAttribute('color').getX(i), 6);
      }
    }
    expect(out.drawRange.count).toBe(2 * (geo.index?.count ?? 0));
    // It culls as one, by its items' own bounds (not the whole buffer, not the world's origin).
    expect(batch.mesh.frustumCulled).toBe(true);
    const sphere = out.boundingSphere;
    expect(sphere?.radius ?? Infinity).toBeLessThan(30);
    const cam = new PerspectiveCamera(62, 915 / 412, 0.3, 760);
    cam.position.set(0, 2, 200);
    cam.lookAt(0, 2, 400);
    cam.updateMatrixWorld(true);
    const behind = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
    expect(behind.intersectsObject(batch.mesh)).toBe(false);
  });

  it('grows past its first buffer and keeps drawing everything', () => {
    const cone = mergeBoxes([{ size: [0.4, 0.7, 0.4], at: [0, 0.35, 0], color: '#ff6a13' }]);
    const batch = new PropBatch(look.material('prop', { vertexColors: true }), 'test');
    for (const count of [3, 200, 5]) {
      batch.begin();
      for (let i = 0; i < count; i++) batch.add(cone, new Matrix4().setPosition(i, 0, 0));
      batch.end();
      expect(batch.count).toBe(count);
      expect(batch.mesh.geometry.drawRange.count).toBe(count * (cone.index?.count ?? 0));
    }
  });
});

describe('the smashables draw in one call', () => {
  const standing = (id: number, kind: SmashableSnapshot['kind']): SmashableSnapshot => ({
    id,
    kind,
    name: 'RETURN TO SENDER',
    x: id * 2,
    y: 0,
    z: -30,
    heading: 0,
    smashedTick: -1,
    hitVx: 0,
    hitVz: 0,
  });

  it('a row of mailboxes beside a stack of lobster traps is one draw (it was one per kind)', () => {
    const s = new Smashables(look, () => 0.5);
    s.sync(snap([], [standing(1, 'mailbox'), standing(2, 'mailbox'), standing(3, 'lobster-traps')]), 0);
    expect(s.counts().standing).toEqual({ mailbox: 2, 'lobster-traps': 1 });
    expect(draws(s.root)).toBe(1);
  });

  it("as the renderer wires them, they share the events' still batch: the busy scene stays 3 calls", () => {
    const e = new EventProps(look);
    const s = new Smashables(look, () => 0.5, e.batches().still);
    const props = roadworkBesideSpeedTrap();
    const smash = [standing(1, 'mailbox'), standing(2, 'mailbox'), standing(3, 'lobster-traps')];
    const frame = (t: number, list = smash) => {
      const sn = snap(props, list);
      e.sync(sn, t);
      s.sync(sn, t);
    };
    frame(0);
    expect(draws(e.root) + draws(s.root)).toBe(3);
    const still = e.batches().still;
    expect(still.count).toBe(23 + 3);
    // Both owners standing still: no rewrite, frame after frame.
    const writes = still.writes;
    for (let f = 1; f <= 4; f++) frame(f / 60);
    expect(still.writes).toBe(writes);
    // A mailbox smashed: one rewrite, and its debris is the smashables' one extra draw.
    const hit = [{ ...standing(1, 'mailbox'), smashedTick: 9, hitVx: 8 }, ...smash.slice(1)];
    frame(0.1, hit);
    expect(still.writes).toBe(writes + 1);
    expect(still.count).toBe(23 + 2);
    expect(draws(e.root) + draws(s.root)).toBe(4);
  });
});

describe('what moves every frame is not drawn while all of it is out of view', () => {
  const camera = () => {
    const cam = new PerspectiveCamera(62, 915 / 412, 0.3, 760);
    cam.position.set(0, 2.6, 0);
    cam.lookAt(0, 1, -50);
    cam.updateMatrixWorld(true);
    return new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    );
  };
  /** What three.js would draw: visible, with instances, and (when culled) inside the frustum. */
  const drawn = (m: InstancedMesh, f: Frustum) =>
    m.visible && m.count > 0 && (!m.frustumCulled || f.intersectsObject(m));

  it("a smashed wreck's debris behind the camera is not drawn; ahead, it is", () => {
    const f = camera();
    for (const [z, expected] of [
      [40, false],
      [-40, true],
    ] as const) {
      const s = new Smashables(look, () => 0.5);
      const wreck = { ...standingAt(1, z), smashedTick: 1, hitVx: 0 };
      s.sync(snap([], [wreck]), 0);
      for (let i = 1; i <= 40; i++) s.sync(snap([], [wreck]), i * 0.05);
      const debris = s.root.children.find(
        (o): o is InstancedMesh => o instanceof InstancedMesh && o.name === 'smashable-debris',
      );
      if (!debris) throw new Error('no debris');
      debris.updateMatrixWorld(true);
      expect(drawn(debris, f), `wreck at z ${z}`).toBe(expected);
    }
  });

  it("a flare's glow behind the camera is not drawn; ahead, it is", () => {
    const f = camera();
    const e = new EventProps(look);
    e.sync(snap([prop(1, 'flare', { x: 0, z: 30 })]), 0);
    const glow = () =>
      e.root.children.find(
        (o): o is InstancedMesh => o instanceof InstancedMesh && o.name === 'event-flareGlow',
      );
    const g = glow();
    if (!g) throw new Error('no glow');
    expect(drawn(g, f)).toBe(false);
    e.sync(snap([prop(1, 'flare', { x: 0, z: 30 }), prop(2, 'flare', { x: 1, z: -30 })]), 0.1);
    expect(drawn(g, f)).toBe(true);
  });

  it('a traffic shape with every car behind the camera is not drawn; one car ahead and it is', () => {
    const f = camera();
    const views = new EntityViews(look);
    const car = (id: number, z: number): EntitySnapshot => ({
      id,
      kind: 'vehicle',
      mode: 'Road',
      road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 2,
      y: 0,
      z,
      heading: 0,
      speed: 10,
      lean: 0,
      contentId: 'base:rental-convertible',
      name: `car${id}`,
      faction: 'rider',
      slot: -1,
      throttle: 0,
      rpm: 0,
      gear: 1,
      grounded: true,
      health: 100,
      healthMax: 100,
      attackPhase: 'idle',
      heldWeapon: null,
      targetId: -1,
      lastAttackerId: -1,
      progress: 0,
      distanceToFinish: 1000,
      place: 1,
      finished: false,
    });
    const frame = (cars: EntitySnapshot[], t: number) =>
      views.sync(null, { ...snap([]), entities: cars }, 1, t);
    frame([car(1, 30), car(2, 60)], 0);
    const mesh = views.root.children.find(
      (o): o is InstancedMesh => o instanceof InstancedMesh && o.visible && o.count > 0,
    );
    if (!mesh) throw new Error('no traffic mesh');
    expect(mesh.count).toBe(2);
    expect(drawn(mesh, f)).toBe(false);
    frame([car(1, 30), car(2, 60), car(3, -80)], 0.1);
    expect(drawn(mesh, f)).toBe(true);
  });

  function standingAt(id: number, z: number): SmashableSnapshot {
    return {
      id,
      kind: 'mailbox',
      name: 'RETURN TO SENDER',
      x: 0,
      y: 0,
      z,
      heading: 0,
      smashedTick: -1,
      hitVx: 0,
      hitVz: 0,
    };
  }
});

describe("the road's fine detail stays near (run W-T, the draw-call headroom)", () => {
  // A long straight-ish road: chunks out to well past the far plane.
  const road = createRoadNetwork(
    fixtureNetwork(
      Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, lengthM: 400, kappa: i % 2 ? 0.0008 : -0.0006 })),
    ),
  );

  it('draws markings and dashes only in the chunks within 300 m of the camera', () => {
    const rs = buildRoadScene(road, look);
    const eye = road.toWorld(0, 20, 0, 2.6);
    rs.update(eye.x, eye.z, 0, 360);
    const marks: { chunk: string; visible: boolean }[] = [];
    rs.group.traverse((o) => {
      if (o instanceof Mesh && o.name === 'road-marking') {
        const chunk = o.parent?.name.replace('road-chunk-', '') ?? '';
        marks.push({ chunk, visible: o.visible });
      }
    });
    expect(marks.length).toBeGreaterThan(2);
    for (const m of marks)
      expect(m.visible, m.chunk).toBe(chunkDistance(m.chunk, eye.x, eye.z) < ROAD_FINE_DRAW_M);
    expect(marks.some((m) => m.visible)).toBe(true);
    expect(marks.some((m) => !m.visible)).toBe(true);
    // The surfaces stay: every chunk still draws its road.
    rs.group.traverse((o) => {
      if (o instanceof Mesh && o.name === 'road-road') expect(o.visible).toBe(true);
    });
    // Riding on, the far chunk's detail comes back as the camera nears it.
    const far = marks.find((m) => !m.visible);
    if (!far) return;
    const [i = 0, j = 0] = far.chunk.split(',').map(Number);
    rs.update((i + 0.5) * 512, (j + 0.5) * 512, 0, 360);
    rs.group.traverse((o) => {
      if (o instanceof Mesh && o.name === 'road-marking' && o.parent?.name === `road-chunk-${far.chunk}`)
        expect(o.visible).toBe(true);
    });
  });
});

describe('the moving ramp truck and the new local life keep the composed peak at 104 of 120 (playtest 3, T4.3)', () => {
  // The plan's composition (scratch/pt3/critic.md section 6, from the specs): today's peak scene
  // (Keys seed 5, a roadwork beside a speed trap) is 96 calls; the drift's skids and smoke add 2; a
  // moving carrier adds up to 3; and a region's new kinds of traffic add up to 3 more. The composed
  // figure is what the perf gate sees, 104 of the 120 it allows. Each term below is measured here as
  // the number of calls its figures add to a scene, so the sum stays true if a figure grows a mesh.
  const PEAK_TODAY = 96;
  const SKIDS_AND_SMOKE = 2;
  const CARRIER_BUDGET = 3;
  const NEW_KINDS_BUDGET = 3;
  const COMPOSED_CAP = 104;
  const FRAME_BUDGET = 120;

  const types: SimTrafficTypeDef[] = [
    ['base:event-car-carrier', 'truck', 7.5, 2.4],
    ['base:rental-convertible', 'car', 4.6, 1.8],
    ['base:box-truck', 'truck', 7.5, 2.4],
    ['base:pedicab', 'car', 2.6, 1.2],
    ['base:island-tram', 'truck', 14, 2.2],
    ['base:rooster', 'animal', 0.45, 0.3],
    ['region-pnw:pdx-streetcar', 'truck', 20, 2.5],
    ['region-pnw:elk', 'animal', 2.4, 0.9],
    ['region-pnw:raccoon', 'animal', 0.6, 0.3],
    ['region-sf:sea-lion', 'animal', 2, 0.8],
    ['region-sf:parrot-flock', 'animal', 2, 2],
    ['base:tourist-with-cooler', 'pedestrian', 0.5, 0.6],
  ].map(([contentId, category, lengthM, widthM]) => ({
    contentId: contentId as string,
    category: category as SimTrafficTypeDef['category'],
    lengthM: lengthM as number,
    widthM: widthM as number,
    cruiseMps: 10,
    hazard: 'normal',
  }));

  let nextId = 1;
  const thing = (contentId: string, z: number): EntitySnapshot => {
    const t = types.find((x) => x.contentId === contentId);
    const kind = t?.category === 'pedestrian' || t?.category === 'animal' ? 'ped' : 'vehicle';
    return {
      id: nextId++,
      kind,
      mode: 'Road',
      road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 2,
      y: 0,
      z,
      heading: 0,
      speed: 10,
      lean: 0,
      contentId,
      name: `t${nextId}`,
      faction: 'rider',
      slot: -1,
      throttle: 0,
      rpm: 0,
      gear: 1,
      grounded: true,
      health: 100,
      healthMax: 100,
      attackPhase: 'idle',
      heldWeapon: null,
      targetId: -1,
      lastAttackerId: -1,
      progress: 0,
      distanceToFinish: 1000,
      place: 1,
      finished: false,
    };
  };
  /** The ordinary traffic every scene has: cars, a box truck, a pedestrian. */
  const ordinary = () => [
    thing('base:rental-convertible', -30),
    thing('base:rental-convertible', -50),
    thing('base:box-truck', -70),
    thing('base:tourist-with-cooler', -40),
  ];
  /** Draw calls the entity views make for these entities, after any events. */
  function callsFor(entities: EntitySnapshot[], rampDown: number[] = []): number {
    const views = new EntityViews(look);
    views.setTrafficTypes(types);
    views.sync(null, { ...snap([]), entities }, 1, 0);
    views.pushEvents(
      rampDown.map((actor) => ({ tick: 1, type: 'setPieceBeat', actor, data: { beat: 'rampDown' } })),
    );
    views.sync(null, { ...snap([]), entities }, 1, 0.1);
    return draws(views.root);
  }
  const base = callsFor(ordinary());

  it('a carrier is one call, two with one ramp up and one down (a double), and never more than 3', () => {
    const lone = thing('base:event-car-carrier', -100);
    const second = thing('base:event-car-carrier', -170);
    const one = callsFor([...ordinary(), lone]) - base;
    const double = callsFor([...ordinary(), lone, second], [second.id]) - base;
    const bothDown = callsFor([...ordinary(), lone, second], [lone.id, second.id]) - base;
    console.log(
      `[examined] draw calls a carrier adds: lone ${one}, up and down ${double}, both down ${bothDown}`,
    );
    expect(one).toBe(1);
    expect(double).toBe(2);
    expect(bothDown).toBe(1);
    expect(Math.max(one, double, bothDown)).toBeLessThanOrEqual(CARRIER_BUDGET);
  });

  it("a region's new kinds are one call each, however many of each are in view", () => {
    const keys = ['base:pedicab', 'base:island-tram', 'base:rooster'];
    const pnw = ['region-pnw:pdx-streetcar', 'region-pnw:elk', 'region-pnw:raccoon'];
    const sf = ['region-sf:sea-lion', 'region-sf:parrot-flock'];
    for (const [region, ids] of [
      ['Keys', keys],
      ['Pacific Northwest', pnw],
      ['San Francisco', sf],
    ] as const) {
      const crowd = ids.flatMap((id, k) => [
        thing(id, -60 - k * 20),
        thing(id, -62 - k * 20),
        thing(id, -64 - k * 20),
      ]);
      const added = callsFor([...ordinary(), ...crowd]) - base;
      console.log(
        `[examined] draw calls ${region}'s ${ids.length} new kinds add (3 of each in view): ${added}`,
      );
      expect(added, region).toBe(ids.length);
      expect(added, region).toBeLessThanOrEqual(NEW_KINDS_BUDGET);
    }
  });

  it('the worst scene composed is at most 104, and the frame budget keeps its headroom', () => {
    const lone = thing('base:event-car-carrier', -100);
    const second = thing('base:event-car-carrier', -170);
    const crowd = ['base:pedicab', 'base:island-tram', 'base:rooster'].flatMap((id, k) => [
      thing(id, -60 - k * 20),
      thing(id, -62 - k * 20),
    ]);
    const added = callsFor([...ordinary(), lone, second, ...crowd], [second.id]) - base;
    const composed = PEAK_TODAY + SKIDS_AND_SMOKE + added;
    console.log(
      `[examined] composed peak: ${PEAK_TODAY} today + ${SKIDS_AND_SMOKE} skids and smoke + ${added} (a carrier up and down and three new kinds) = ${composed} of ${FRAME_BUDGET}`,
    );
    expect(added).toBeLessThanOrEqual(CARRIER_BUDGET + NEW_KINDS_BUDGET);
    expect(composed).toBeLessThanOrEqual(COMPOSED_CAP);
    expect(composed).toBeLessThanOrEqual(FRAME_BUDGET);
  });
});
