// render-2 unit tests (docs/milestones/M2.md, render-2): the hit flash and spark burst, the
// slow-motion tint, the cartwheeling bike and the ragdoll rider on the tumble bodies, the splash with
// its gator or fisherman, the get-up and fist-shake poses, the placeholder boards with the veto's
// `pick` and `visibleRefs`, the tuning sliders (every one changes something), and the draw budget in
// a slow-motion pile-up. Browser screenshots of a real takedown and splash wait for combat-4 and
// tumble-2 to emit those events in a race (dev-4's bot race).
import {
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import budget from '../../tests/perf/budget.json';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import type { EntitySnapshot, SimEvent, SimSnapshot, TumbleSnapshot } from '../sim/api';
import { Boards, resolveSlot, VISIBLE_M, type BoardCatalog, type BoardItem, type BoardSlot } from './boards';
import { FeelEffects } from './effects';
import { clientToNdc } from './index';
import { createFlatLook } from './look';
import { buildRoadScene } from './road-mesh';
import { applyRenderParam, defaultRenderParams, RENDER_TUNING, type RenderParams } from './tuning';
import { EntityViews } from './views';

// ---- Builders ------------------------------------------------------------------------------

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
    x: id * 2,
    y: 1,
    z: -100,
    heading: 0,
    speed: 25,
    lean: 0,
    contentId: `base:r${id}`,
    name: `r${id}`,
    faction: 'rider',
    slot: id === 0 ? 0 : -1,
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
    ...over,
  };
}

function snap(entities: EntitySnapshot[], over: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 1,
    timeScale: 1,
    entities,
    race: { over: false, routeLength: 3500, finishOrder: [] },
    ...over,
  };
}

function ev(
  type: SimEvent['type'],
  actor: number,
  target?: number,
  data: SimEvent['data'] = {},
  tick = 10,
): SimEvent {
  return target === undefined ? { tick, type, actor, data } : { tick, type, actor, target, data };
}

function rig(over: Partial<RenderParams> = {}) {
  const look = createFlatLook();
  const params = { ...defaultRenderParams(), ...over };
  const fx = new FeelEffects(look, params);
  const views = new EntityViews(look, { effects: fx, params });
  return { look, params, fx, views };
}

/** Runs frames of 1/60 s from `t0`, returning the time after the last. */
function frames(views: EntityViews, s: SimSnapshot, n: number, t0: number): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += 1 / 60;
    views.sync(s, s, 1, t);
  }
  return t;
}

function riderGroup(views: EntityViews, index = 0): Group {
  const groups = views.root.children.filter(
    (c): c is Group => c instanceof Group && c.visible && c.children.length === 5,
  );
  const g = groups[index];
  if (!g) throw new Error('no rider view');
  return g;
}

function named(root: Object3D, name: string): Object3D {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return o;
}

/** What the renderer would submit with no frustum culling: an upper bound on draw calls. */
function drawLoad(root: Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0;
  let triangles = 0;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh) {
      const g = (o as Mesh<BufferGeometry>).geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = o instanceof InstancedMesh ? o.count : 1;
      if (n > 0 && tris > 0) {
        drawCalls++;
        triangles += tris * n;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return { drawCalls, triangles };
}

const bodies = (rx: number, rz: number, bx: number, bz: number, speed: number): TumbleSnapshot => ({
  rider: { x: rx, y: 1, z: rz, vx: 0, vy: 0, vz: -speed },
  bike: { x: bx, y: 0.5, z: bz, vx: 0, vy: 0, vz: -speed },
});

// ---- Hits ----------------------------------------------------------------------------------

describe('the hit flash and spark burst', () => {
  it('flashes the target for hitFlashS and throws sparks where the hit landed', () => {
    const { look, fx, views } = rig();
    const s = snap([rider(0, { x: 0 }), rider(1, { x: 1.2 })]);
    views.sync(null, s, 1, 0);
    views.pushEvents([ev('hit', 0, 1)]);
    views.sync(s, s, 1, 0.02);
    const target = riderGroup(views, 1).children[0] as Mesh;
    expect(target.material).toBe(look.material('flash', { vertexColors: true }));
    expect((riderGroup(views, 0).children[0] as Mesh).material).toBe(
      look.material('rider', { vertexColors: true }),
    );
    expect(fx.counts().sparks).toBe(12);
    views.sync(s, s, 1, 0.2);
    expect(target.material).toBe(look.material('rider', { vertexColors: true }));
    // Sparks burn out within a second.
    frames(views, s, 60, 0.2);
    expect(fx.counts().sparks).toBe(0);
  });

  it('follows the flash-length and spark-speed sliders', () => {
    const flashed = (hitFlashS: number) => {
      const { look, views } = rig({ hitFlashS });
      const s = snap([rider(0), rider(1, { x: 1.2 })]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev('hit', 0, 1)]);
      views.sync(s, s, 1, 0.05);
      return (
        (riderGroup(views, 1).children[0] as Mesh).material === look.material('flash', { vertexColors: true })
      );
    };
    expect(flashed(0)).toBe(false);
    expect(flashed(0.2)).toBe(true);
    const spread = (sparkSpeedMps: number) => {
      const { fx, views } = rig({ sparkSpeedMps, sparkCount: 40 });
      const s = snap([rider(0), rider(1, { x: 1.2 })]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev('hit', 0, 1)]);
      views.sync(s, s, 1, 0.001);
      frames(views, s, 6, 0.001);
      const mesh = fx.root.getObjectByName('feel-sparks') as InstancedMesh;
      mesh.computeBoundingSphere();
      return mesh.boundingSphere?.radius ?? 0;
    };
    expect(spread(18)).toBeGreaterThan(spread(2) * 2);
  });

  it('throws more sparks for a kick than a punch, and none with the slider at zero', () => {
    const count = (type: 'hit' | 'kick', over: Partial<RenderParams> = {}) => {
      const { fx, views } = rig(over);
      const s = snap([rider(0), rider(1, { x: 1.2 })]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev(type, 0, 1)]);
      views.sync(s, s, 1, 0.001);
      return fx.counts().sparks;
    };
    expect(count('hit')).toBe(12);
    expect(count('kick')).toBe(18);
    expect(count('hit', { sparkCount: 30 })).toBe(30);
    expect(count('kick', { sparkCount: 0 })).toBe(0);
  });

  it('sparks on a crash and on a rail scrape, and flashes a takedown victim twice as long', () => {
    const { look, fx, views } = rig();
    const s = snap([rider(0), rider(1, { x: 1.2 })]);
    views.sync(null, s, 1, 0);
    views.pushEvents([ev('crash', 1), ev('takedown', 0, 1, { kind: 'traffic' })]);
    views.sync(s, s, 1, 0.001);
    expect(fx.counts().sparks).toBe(24 + 18);
    views.sync(s, s, 1, 0.15); // past one flash, inside two
    expect((riderGroup(views, 1).children[0] as Mesh).material).toBe(
      look.material('flash', { vertexColors: true }),
    );
    const { fx: fx2, views: v2 } = rig();
    v2.sync(null, s, 1, 0);
    v2.pushEvents([ev('railOver', 1, undefined, { body: 'rider' })]);
    v2.sync(s, s, 1, 0.001);
    expect(fx2.counts().sparks).toBe(Math.round(12 * 0.8));
  });
});

// ---- Slow motion ---------------------------------------------------------------------------

describe('the slow-motion tint', () => {
  const tintAfter = (s: SimSnapshot, over: Partial<RenderParams> = {}) => {
    const { fx, views } = rig(over);
    views.sync(null, s, 1, 0);
    frames(views, s, 30, 0);
    return fx;
  };

  it('fades in while the slow motion runs and out when it ends', () => {
    const slow = snap([rider(0)], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 30 } });
    const { fx, views } = rig();
    views.sync(null, slow, 1, 0);
    const t = frames(views, slow, 30, 0);
    expect(fx.counts().tint).toBeCloseTo(0.28);
    expect(fx.tint.visible).toBe(true);
    const normal = snap([rider(0)]);
    frames(views, normal, 30, t);
    expect(fx.counts().tint).toBe(0);
    expect(fx.tint.visible).toBe(false);
  });

  it('follows the slider, and stays off in a hit-stop or at full speed', () => {
    const slow = snap([rider(0)], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 30 } });
    expect(tintAfter(slow, { slowmoTint: 0.6 }).counts().tint).toBeCloseTo(0.6);
    expect(tintAfter(slow, { slowmoTint: 0 }).counts().tint).toBe(0);
    expect(tintAfter(snap([rider(0)], { timeScale: 0 })).counts().tint).toBe(0);
    expect(tintAfter(snap([rider(0)])).counts().tint).toBe(0);
  });

  it('tints cool blue, not white (its vertex colours only carry the vignette)', () => {
    const { fx } = rig();
    const color = (fx.tint.material as MeshBasicMaterial).color;
    expect(color.b).toBeGreaterThan(color.r + 0.3);
    expect(color.getHexString()).not.toBe('ffffff');
  });

  it('sizes the tint to cover the camera view', () => {
    const { fx } = rig();
    const camera = new PerspectiveCamera(60, 2, 0.3, 1500);
    fx.fitTint(camera);
    const dist = -fx.tint.position.z;
    const needH = 2 * dist * Math.tan(Math.PI / 6);
    expect(fx.tint.scale.y).toBeGreaterThanOrEqual(needH);
    expect(fx.tint.scale.x).toBeGreaterThanOrEqual(needH * 2);
    expect(dist).toBeGreaterThan(camera.near);
  });
});

// ---- The crash -----------------------------------------------------------------------------

describe('the cartwheeling bike and the ragdoll rider', () => {
  it('draws the bike on its own body, apart from the rider, spinning end over end', () => {
    const { views } = rig();
    const s = snap([rider(0, { mode: 'Tumble', speed: 15, tumble: bodies(0, -100, 3, -106, 15) })]);
    views.sync(null, s, 1, 0);
    const bike = named(views.root, 'views-tumble-bike');
    expect(bike.visible).toBe(true);
    expect(bike.position.x).toBeCloseTo(3);
    expect(bike.position.z).toBeCloseTo(-106);
    const pitch0 = bike.rotation.x;
    const riderPitch0 = riderGroup(views).rotation.x;
    frames(views, s, 10, 0);
    expect(Math.abs(bike.rotation.x - pitch0)).toBeGreaterThan(1);
    expect(Math.abs(riderGroup(views).rotation.x - riderPitch0)).toBeGreaterThan(0.3);
    // The rider's middle sits on the rider body, whatever the spin.
    const g = riderGroup(views);
    g.updateMatrixWorld(true);
    const centre = g.localToWorld(new Mesh().position.set(0, 0.9, 0));
    expect(centre.x).toBeCloseTo(0);
    expect(centre.z).toBeCloseTo(-100);
    expect(centre.y).toBeCloseTo(1.25);
  });

  it('spins faster with the slider, not at all at zero, and freezes in a hit-stop', () => {
    const spin = (over: Partial<RenderParams>, timeScale = 1) => {
      const { views } = rig(over);
      const s = snap([rider(0, { mode: 'Tumble', tumble: bodies(0, -100, 3, -106, 12) })], { timeScale });
      views.sync(null, s, 1, 0);
      const bike = named(views.root, 'views-tumble-bike');
      const before = bike.rotation.x;
      frames(views, s, 6, 0);
      return Math.abs(bike.rotation.x - before);
    };
    const normal = spin({});
    expect(normal).toBeGreaterThan(0.5);
    expect(spin({ cartwheelRate: 2 })).toBeGreaterThan(normal * 1.5);
    expect(spin({ cartwheelRate: 0 })).toBe(0);
    expect(spin({}, 0)).toBe(0);
    expect(spin({}, 0.3)).toBeLessThan(normal * 0.5);
  });

  it('lays the bike on its side and the rider flat once they stop', () => {
    const { views } = rig();
    const s = snap([rider(0, { mode: 'Tumble', speed: 0, tumble: bodies(0, -100, 3, -106, 0) })]);
    views.sync(null, s, 1, 0);
    frames(views, s, 90, 0);
    const bike = named(views.root, 'views-tumble-bike');
    expect(bike.rotation.z).toBeCloseTo(Math.PI / 2, 1);
    expect(bike.position.y).toBeCloseTo(0.5 + 0.22, 1);
    expect(Math.abs(riderGroup(views).rotation.x)).toBeCloseTo(Math.PI / 2, 1);
  });

  it('throws the bike clear even without body data, and hides it once the rider is up', () => {
    const { views } = rig();
    views.sync(null, snap([rider(0, { mode: 'Tumble' })]), 1, 0);
    const bike = named(views.root, 'views-tumble-bike');
    expect(bike.visible).toBe(true);
    expect(Math.hypot(bike.position.x - 0, bike.position.z + 100)).toBeGreaterThan(1);
    views.sync(
      null,
      snap([rider(0, { mode: 'OnFoot', parkedBike: { x: 3, y: 0, z: -106, heading: 0 } })]),
      1,
      0.1,
    );
    expect(bike.visible).toBe(false);
    expect(named(views.root, 'views-parked-bike').visible).toBe(true);
    views.sync(null, snap([rider(0)]), 1, 0.2);
    expect(bike.visible).toBe(false);
  });
});

// ---- The splash ----------------------------------------------------------------------------

describe('the splash', () => {
  const splashAt = (actor: number, tick: number) => {
    const { fx, views } = rig();
    // The rider is on the bridge at x = 0; the body went over the rail into the sea at x = 9.
    const me = rider(actor, {
      mode: 'Tumble',
      x: 0,
      z: -100,
      tumble: {
        rider: { x: 9, y: 0, z: -101, vx: 0, vy: -5, vz: 0 },
        bike: { x: 0, y: 5, z: -100, vx: 0, vy: 0, vz: 0 },
      },
    });
    const s = snap([me]);
    views.sync(null, s, 1, 0);
    views.pushEvents([ev('splash', actor, undefined, { body: 'rider', penaltyTicks: 240 }, tick)]);
    views.sync(s, s, 1, 0.001);
    return { fx, views, s };
  };

  it('throws water, spreads a ring and brings up a gator, away from the bridge', () => {
    const { fx, views, s } = splashAt(0, 10);
    expect(fx.counts().drops).toBe(40);
    expect(fx.counts().rings).toBe(1);
    expect(fx.counts().reactors).toBe(1);
    const gator = named(fx.root, 'feel-gator');
    expect(gator.visible).toBe(true);
    expect(named(fx.root, 'feel-fisherman').visible).toBe(false);
    // Out past the splash, on the far side from the road.
    expect(gator.position.x).toBeGreaterThan(9);
    const t = frames(views, s, 30, 0.001);
    expect(gator.position.y).toBeGreaterThan(-0.2); // surfaced
    frames(views, s, 60 * 3, t);
    expect(gator.visible).toBe(false);
    expect(fx.counts().drops).toBe(0);
    expect(fx.counts().rings).toBe(0);
  });

  it('brings the fisherman instead on the other parity, and keeps him for reactorS', () => {
    const { fx, views, s } = splashAt(0, 11);
    const fisher = named(fx.root, 'feel-fisherman');
    expect(fisher.visible).toBe(true);
    expect(named(fx.root, 'feel-gator').visible).toBe(false);
    frames(views, s, 60 * 2, 0.001);
    expect(fisher.visible).toBe(true);
    // Arms up.
    const arms = fisher.children.filter((c) => c instanceof Group);
    expect(arms.length).toBe(2);
    expect(Math.abs(arms[0]?.rotation.z ?? 0)).toBeGreaterThan(2);

    const short = rig({ reactorS: 1 });
    const me = rider(0, {
      tumble: {
        rider: { x: 9, y: 0, z: -100, vx: 0, vy: 0, vz: 0 },
        bike: { x: 0, y: 0, z: -100, vx: 0, vy: 0, vz: 0 },
      },
    });
    const s2 = snap([me]);
    short.views.sync(null, s2, 1, 0);
    short.views.pushEvents([ev('splash', 0, undefined, { body: 'rider' }, 11)]);
    frames(short.views, s2, 70, 0);
    expect(named(short.fx.root, 'feel-fisherman').visible).toBe(false);
  });

  it('throws the water higher with the splash-height slider', () => {
    const peak = (splashHeightM: number) => {
      const { fx, views } = rig({ splashHeightM });
      const s = snap([
        rider(0, {
          tumble: {
            rider: { x: 9, y: 0, z: -100, vx: 0, vy: 0, vz: 0 },
            bike: { x: 0, y: 0, z: -100, vx: 0, vy: 0, vz: 0 },
          },
        }),
      ]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev('splash', 0, undefined, {}, 10)]);
      views.sync(s, s, 1, 0.001);
      const drops = fx.root.getObjectByName('feel-splash-drops') as InstancedMesh;
      let top = 0;
      let t = 0.001;
      for (let i = 0; i < 90; i++) {
        t = frames(views, s, 1, t);
        drops.computeBoundingSphere();
        top = Math.max(
          top,
          drops.boundingSphere ? drops.boundingSphere.center.y + drops.boundingSphere.radius : 0,
        );
      }
      return top;
    };
    expect(peak(10)).toBeGreaterThan(peak(2) * 1.5);
  });
});

// ---- Get-up and fist shake ---------------------------------------------------------------

describe('the get-up and the fist shake', () => {
  it('stands up from lying over getUpS, then shakes a fist at the rider to blame', () => {
    const { views } = rig();
    const me = rider(1, { mode: 'OnFoot', x: 0, z: -100, speed: 0, heading: 0 });
    const blamed = rider(0, { x: 10, z: -100 });
    const s = snap([blamed, me]);
    views.sync(null, s, 1, 0);
    views.pushEvents([ev('getUp', 1)]);
    views.sync(s, s, 1, 0.001);
    const g = riderGroup(views, 1);
    expect(g.rotation.x).toBeLessThan(-1.3); // still nearly flat
    let t = frames(views, s, 36, 0.001);
    expect(Math.abs(g.rotation.x)).toBeLessThan(0.05); // standing
    views.pushEvents([ev('fistShake', 1, 0)]);
    t = frames(views, s, 2, t);
    // Facing the blamed rider (+x): a model facing -z turned by h looks along (-sin h, -cos h).
    expect(-Math.sin(g.rotation.y)).toBeCloseTo(1, 3);
    const right = g.children[2] as Group;
    expect(right.rotation.z).toBeGreaterThan(2.5);
    frames(views, s, 90, t);
    expect(right.rotation.z).toBeLessThan(1);
  });

  it('follows the get-up and fist-shake sliders', () => {
    const standing = (getUpS: number) => {
      const { views } = rig({ getUpS });
      const s = snap([rider(1, { mode: 'OnFoot', speed: 0 })]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev('getUp', 1)]);
      frames(views, s, 30, 0); // half a second
      return Math.abs(riderGroup(views).rotation.x);
    };
    expect(standing(0.3)).toBeLessThan(0.05);
    expect(standing(1.5)).toBeGreaterThan(0.3);
    const shaking = (fistShakeS: number) => {
      const { views } = rig({ fistShakeS });
      const s = snap([rider(1, { mode: 'OnFoot', speed: 0 })]);
      views.sync(null, s, 1, 0);
      views.pushEvents([ev('fistShake', 1)]);
      frames(views, s, 60, 0);
      return (riderGroup(views).children[2] as Group).rotation.z > 2.5;
    };
    expect(shaking(0.5)).toBe(false);
    expect(shaking(2)).toBe(true);
  });
});

// ---- Boards and the veto picker ----------------------------------------------------------

describe('the placeholder boards', () => {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 300, kappa: 0 }]));
  const item = (id: string, kind: BoardItem['kind'], text: string): BoardItem => ({
    ref: `base:region/florida-keys#${id}`,
    text,
    kind,
  });
  const catalog: BoardCatalog = {
    items: { timeshare: item('timeshare', 'billboard', 'TIMESHARE ON A SANDBAR') },
    pools: { signs: [item('a', 'sign', 'A'), item('b', 'sign', 'B'), item('c', 'sign', 'C')] },
  };
  const slots: BoardSlot[] = [
    { kind: 'billboard', id: 'bb-1', s0: 140, s1: 160, d0: 8, d1: 12, item: 'timeshare' },
    { kind: 'billboard', id: 'bb-2', s0: 60, s1: 64, d0: -9, d1: -7, pool: 'signs' },
    { kind: 'billboard', id: 'bb-3', s0: 200, s1: 210, d0: 8, d1: 11, item: 'no-such-item' },
    { kind: 'ramp', s0: 20, s1: 30, d0: 0, d1: 3 },
  ];
  const built = () => {
    const boards = new Boards(createFlatLook());
    boards.build(road, (id) => (id === 'flat' ? slots : undefined), catalog);
    return boards;
  };
  /** A camera `back` metres before the board along the road, level with its face, looking at it. */
  const cameraAt = (boards: Boards, ref: string, back: number) => {
    const b = boards.all().find((v) => v.ref === ref);
    if (!b) throw new Error(`no board ${ref}`);
    const cam = new PerspectiveCamera(60, 16 / 9, 0.3, 1500);
    cam.position.set(b.centre.x, b.centre.y, b.centre.z + back); // the road runs toward -z
    cam.lookAt(b.centre);
    cam.updateMatrixWorld(true);
    return cam;
  };

  it('builds one board per resolvable slot, tagged with its content reference', () => {
    const boards = built();
    expect(boards.all().map((b) => [b.slotId, b.kind])).toEqual([
      ['bb-1', 'billboard'],
      ['bb-2', 'sign'],
    ]);
    const panel = boards.all()[0]?.panel;
    expect(panel?.userData['contentRef']).toBe('base:region/florida-keys#timeshare');
    // Beside the road, at the slot's lateral range, standing on the surface.
    const b = boards.all()[0];
    const at = road.toWorld(0, 150, 10, 0);
    expect(b?.group.position.x).toBeCloseTo(at.x);
    expect(b?.group.position.z).toBeCloseTo(at.z);
  });

  it('fills a pool slot with a stable item, and draws nothing without a catalog', () => {
    const slot = slots[1] as BoardSlot;
    const first = resolveSlot(slot, catalog);
    expect(first).not.toBeNull();
    for (let i = 0; i < 5; i++) expect(resolveSlot(slot, catalog)).toBe(first);
    expect(built().all()[1]?.ref).toBe(first?.ref);
    const bare = new Boards(createFlatLook());
    bare.build(road, () => slots, undefined);
    expect(bare.all()).toHaveLength(0);
  });

  it('picks the board under a point (either face) and nothing beside it', () => {
    const boards = built();
    const ref = 'base:region/florida-keys#timeshare';
    expect(boards.pick(0, 0, cameraAt(boards, ref, 40))).toBe(ref);
    expect(boards.pick(0, 0, cameraAt(boards, ref, -40))).toBe(ref); // from the other direction
    expect(boards.pick(0.9, 0.9, cameraAt(boards, ref, 40))).toBeNull();
  });

  it('lists the boards in view and within range, and forgets a vetoed one at once', () => {
    const boards = built();
    const ref = 'base:region/florida-keys#timeshare';
    expect(boards.visibleRefs(cameraAt(boards, ref, 60))).toContain(ref);
    // Looking away.
    const away = cameraAt(boards, ref, 60);
    away.rotateY(Math.PI);
    away.updateMatrixWorld(true);
    expect(boards.visibleRefs(away)).not.toContain(ref);
    // Too far to read.
    expect(boards.visibleRefs(cameraAt(boards, ref, VISIBLE_M + 50))).not.toContain(ref);
    boards.hide([ref]);
    expect(boards.pick(0, 0, cameraAt(boards, ref, 40))).toBeNull();
    expect(boards.visibleRefs(cameraAt(boards, ref, 60))).not.toContain(ref);
    // A rebuild keeps the veto.
    boards.build(road, () => slots, catalog);
    expect(boards.pick(0, 0, cameraAt(boards, ref, 40))).toBeNull();
  });

  it('turns client pixels into device coordinates over the canvas rect', () => {
    const rect = { left: 10, top: 20, width: 200, height: 100 };
    expect(clientToNdc(110, 70, rect)).toEqual({ x: 0, y: 0 });
    expect(clientToNdc(10, 20, rect)).toEqual({ x: -1, y: 1 });
    expect(clientToNdc(210, 120, rect)).toEqual({ x: 1, y: -1 });
  });
});

// ---- Tuning --------------------------------------------------------------------------------

describe('the render tuning sliders', () => {
  it('declares every feel number as a presentation-only slider with its default in range', () => {
    const ids = RENDER_TUNING.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(Object.keys(defaultRenderParams()).length);
    for (const d of RENDER_TUNING) {
      expect(d.id.startsWith('render.')).toBe(true);
      expect(d.affectsSim).toBe(false);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
    }
    console.log(`[examined] ${RENDER_TUNING.length} render sliders: ${ids.join(', ')}`);
  });

  it('applies a render value clamped to its range and ignores other ids', () => {
    const p = defaultRenderParams();
    expect(applyRenderParam(p, 'render.sparkCount', 20)).toBe(true);
    expect(p.sparkCount).toBe(20);
    applyRenderParam(p, 'render.slowmoTint', 5);
    expect(p.slowmoTint).toBe(0.7);
    expect(applyRenderParam(p, 'camera.heightM', 3)).toBe(false);
    expect(applyRenderParam(p, 'render.nope', 3)).toBe(false);
    expect(applyRenderParam(p, 'render.hitFlashS', Number.NaN)).toBe(false);
    expect(p.hitFlashS).toBe(0.1);
  });
});

// ---- Budget --------------------------------------------------------------------------------

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function realNetwork(): RoadNetwork {
  const roads = Object.values(roadFiles);
  const network = Object.values(networkFiles).find((n) =>
    n.roads.every((id) => roads.some((r) => r.id === id)),
  );
  if (!network) throw new Error('no baked network');
  return createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) });
}

describe('the draw budget in a slow-motion pile-up (no frustum culling, so an upper bound)', () => {
  it('stays inside the draw-call and triangle budgets', () => {
    const look = createFlatLook();
    const params = defaultRenderParams();
    const fx = new FeelEffects(look, params);
    const views = new EntityViews(look, { effects: fx, params });
    const scene = new Scene();
    const road = realNetwork();
    scene.add(buildRoadScene(road, look).group);
    const boards = new Boards(look);
    const edge = road.edges[0];
    if (!edge) throw new Error('no edge');
    const s0 = Math.min(100, edge.length / 2);
    boards.build(
      road,
      (id) =>
        id === edge.id
          ? [
              { kind: 'billboard', id: 'b1', s0, s1: s0 + 10, d0: 9, d1: 13, item: 'x' },
              { kind: 'billboard', id: 'b2', s0: s0 + 20, s1: s0 + 30, d0: -13, d1: -9, item: 'x' },
              { kind: 'billboard', id: 'b3', s0: s0 + 40, s1: s0 + 44, d0: 9, d1: 11, pool: 'signs' },
            ]
          : undefined,
      {
        items: { x: { ref: 'base:region/r#x', text: 'X', kind: 'billboard' } },
        pools: { signs: [{ ref: 'base:region/r#s', text: 'S', kind: 'sign' }] },
      },
    );
    const camera = new PerspectiveCamera(60, 16 / 9, 0.3, 1500);
    camera.add(fx.tint);
    scene.add(views.root, fx.root, boards.root, camera);
    // Six riders all down at once with their bikes flying, a crowd of traffic, every hit sparking,
    // a splash with its reactor, and the slow motion's tint.
    const riders = [0, 1, 2, 3, 4, 5].map((id) =>
      rider(id, { mode: 'Tumble', tumble: bodies(id * 2, -100, id * 2 + 3, -106, 14) }),
    );
    const traffic: EntitySnapshot[] = [];
    for (let i = 0; i < 38; i++) {
      traffic.push({
        ...rider(100 + i),
        kind: 'vehicle',
        contentId: i < 8 ? 'base:box-truck' : 'base:sedan',
        slot: -1,
      });
    }
    const s = snap([...riders, ...traffic], { timeScale: 0.3, slowmo: { active: true, remainingTicks: 40 } });
    views.sync(null, s, 1, 0);
    const events: SimEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(ev('kick', i, (i + 1) % 6), ev('crash', i));
    events.push(ev('splash', 0, undefined, {}, 10), ev('splash', 1, undefined, {}, 10));
    views.pushEvents(events);
    frames(views, s, 10, 0);
    expect(fx.counts().sparks).toBeGreaterThan(0);
    expect(fx.counts().reactors).toBe(2);
    expect(fx.tint.visible).toBe(true);
    const load = drawLoad(scene);
    console.log(
      `[examined] slow-motion pile-up upper bound: ${load.drawCalls} draw calls, ${load.triangles} triangles`,
    );
    expect(load.drawCalls).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(load.triangles).toBeLessThanOrEqual(budget.trianglesMax);
  });
});
