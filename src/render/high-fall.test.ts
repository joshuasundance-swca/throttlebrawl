// High riders in render (the maintainer, playing on the phone, 2026-10-06: "it would be much more
// satisfying to land on it and ride on it"; "go over and across barriers, possibly resulting in a crash
// like falling in the water"; "consistent physics and gameplay is important here so players know what to
// expect"; high falls "(a)": the same physics everywhere, a high drop a clean cut-away with no gag):
// - the shadow falls on what the rider is over or on: the roof he rides, the roof he is above, the sea
//   past a rail, not the road under the truck (`groundYOf`, the snapshot's `floorY`);
// - a LOW splash keeps today's gag (the water, the ring, the gator or the fisherman), at the water's own
//   level (Lake Samish's is not the sea's); a HIGH drop (`high` on the `splash`) has none of it.
// Each has its control. Snapshots are built by hand here; tests/sim/high-riders.test.ts feeds the real
// ones from the sim.
import { Group, InstancedMesh, Matrix4, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { AirPays } from './air-pays';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { groundYOf } from './shadows';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';

function rider(id: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
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

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

const ev = (type: SimEvent['type'], actor: number, data: SimEvent['data'] = {}, tick = 10): SimEvent => ({
  tick,
  type,
  actor,
  data,
});

function rig() {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const fx = new FeelEffects(look, params);
  const views = new EntityViews(look, { effects: fx, params });
  return { fx, views };
}

const named = (root: Object3D, name: string): Object3D => {
  const o = root.getObjectByName(name);
  if (!o) throw new Error(`no ${name}`);
  return o;
};

/** The shadows the views drew: their centres' y (the instance matrices' translation). */
function shadowYs(views: EntityViews): number[] {
  const mesh = named(views.root, 'blob-shadows') as InstancedMesh;
  const out: number[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(v.setFromMatrixPosition(m).y);
  }
  return out;
}

/** The shadows' sizes as the views drew them (the instance matrices' scale in x). */
function shadowWidths(views: EntityViews): number[] {
  const mesh = named(views.root, 'blob-shadows') as InstancedMesh;
  const out: number[] = [];
  const m = new Matrix4();
  const v = new Vector3();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    out.push(v.setFromMatrixScale(m).x);
  }
  return out;
}

const LIFT = 0.04;

/** The shadows' heights match to the float32 the instance matrices hold. */
function expectYs(actual: number[], expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i] ?? NaN, 4));
}

describe('the shadow falls on what the rider is over or on', () => {
  const onRoof = rider(0, {
    y: 3.4,
    road: { edge: 0, s: 100, d: 0, h: 3.4, dir: 1, yaw: 0 },
    grounded: false,
  });
  const overRoof = rider(0, {
    mode: 'Airborne',
    y: 4.4,
    road: { edge: 0, s: 100, d: 0, h: 4.4, dir: 1, yaw: 0 },
    grounded: false,
    floorY: 3.4,
  });
  const overSea = rider(0, {
    mode: 'Airborne',
    y: 6,
    road: { edge: 0, s: 100, d: 9, h: 2, dir: 1, yaw: 0 },
    grounded: false,
    floorY: 0,
  });

  it('riding a roof: on the roof, not the road under the truck', () => {
    expect(groundYOf(onRoof)).toBe(3.4);
    const { views } = rig();
    views.sync(null, snap([onRoof]), 1, 0);
    console.log(
      `[examined] riding a 3.4 m roof: shadow y ${shadowYs(views)
        .map((y) => y.toFixed(2))
        .join(' ')}`,
    );
    expectYs(shadowYs(views), [3.4 + LIFT]);
  });

  it('control: riding the road, or a vehicle on it, the shadow is where it was (the entity’s own height)', () => {
    expect(groundYOf(rider(0, { y: 1 }))).toBe(1);
    const car = rider(5, { kind: 'vehicle', y: 1, road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 } });
    expect(groundYOf(car)).toBe(1);
  });

  it('a metre over a roof: on the roof, fainter than riding it', () => {
    expect(groundYOf(overRoof)).toBe(3.4);
    const a = rig();
    a.views.sync(null, snap([overRoof]), 1, 0);
    const b = rig();
    b.views.sync(null, snap([onRoof]), 1, 0);
    expectYs(shadowYs(a.views), [3.4 + LIFT]);
    expect(shadowWidths(a.views)[0] ?? 0).toBeLessThan(shadowWidths(b.views)[0] ?? 0);
  });

  it('control: no floor in the snapshot (hand-built): the old rule, under him at his height over the road', () => {
    const bare = rider(0, {
      mode: 'Airborne',
      y: 6,
      road: { edge: 0, s: 100, d: 0, h: 4, dir: 1, yaw: 0 },
      grounded: false,
    });
    expect(groundYOf(bare)).toBe(2);
    const { views } = rig();
    views.sync(null, snap([bare]), 1, 0);
    expectYs(shadowYs(views), [2 + LIFT]);
  });

  it('out over the sea past a rail: on the sea, far below, as faint as it goes', () => {
    expect(groundYOf(overSea)).toBe(0);
    const { views } = rig();
    views.sync(null, snap([overSea]), 1, 0);
    expectYs(shadowYs(views), [LIFT]);
    const small = rig();
    small.views.sync(null, snap([rider(0, { y: 0 })]), 1, 0);
    expect(shadowWidths(views)[0] ?? 0).toBeLessThan((shadowWidths(small.views)[0] ?? 0) * 0.5 + 1e-9);
  });

  it('a body falling past the rail has its shadow on the water, not floating at the bridge’s height', () => {
    const falling = rider(0, {
      mode: 'Tumble',
      y: 4,
      road: { edge: 0, s: 100, d: 9, h: 4, dir: 1, yaw: 0 },
      grounded: false,
      floorY: 0,
      tumble: {
        rider: { x: 9, y: 2, z: -101, vx: 0, vy: -5, vz: 0 },
        bike: { x: 9, y: 3, z: -100, vx: 0, vy: -5, vz: 0 },
      },
    });
    expect(groundYOf(falling)).toBe(0);
    const { views } = rig();
    views.sync(null, snap([falling]), 1, 0);
    expectYs(shadowYs(views), [LIFT, LIFT]);
  });
});

describe('a splash: low keeps its gag, a high drop has none', () => {
  /** The body went over a rail into the water at `waterY`, and the splash event says how far it fell. */
  function splashAt(data: SimEvent['data'], waterY = 0, tick = 10) {
    const { fx, views } = rig();
    const me = rider(0, {
      mode: 'Tumble',
      x: 0,
      y: waterY,
      z: -100,
      tumble: {
        rider: { x: 9, y: waterY, z: -101, vx: 0, vy: -5, vz: 0 },
        bike: { x: 0, y: waterY + 5, z: -100, vx: 0, vy: 0, vz: 0 },
      },
    });
    const s = snap([me]);
    views.sync(null, s, 1, 0);
    views.pushEvents([ev('splash', 0, { body: 'rider', penaltyTicks: 240, ...data }, tick)]);
    views.sync(s, s, 1, 0.001);
    return { fx, views };
  }
  const LOW = { over: true, past: 'water', dropM: 4, high: false };
  const HIGH = { over: true, past: 'water', dropM: 68, high: true };

  it('a low drop into water: the droplets, the ring and a reactor, as ever', () => {
    const { fx } = splashAt(LOW);
    expect(fx.counts().drops).toBe(40);
    expect(fx.counts().rings).toBe(1);
    expect(fx.counts().reactors).toBe(1);
  });

  it('a high drop: no water thrown, no ring, no gator, no fisherman', () => {
    for (const tick of [10, 11]) {
      const { fx } = splashAt(HIGH, 0, tick);
      expect(fx.counts().drops).toBe(0);
      expect(fx.counts().rings).toBe(0);
      expect(fx.counts().reactors).toBe(0);
      expect(named(fx.root, 'feel-gator').visible).toBe(false);
      expect(named(fx.root, 'feel-fisherman').visible).toBe(false);
    }
  });

  it('control: a splash with no word of how far (a tumble over a rail, as before) is a low one', () => {
    const { fx } = splashAt({});
    expect(fx.counts().reactors).toBe(1);
    expect(fx.counts().drops).toBe(40);
  });

  it('a low splash at Lake Samish is at the lake’s level (82.85 m), not the sea’s', () => {
    const { fx } = splashAt(LOW, 82.85);
    const ring = fx.root.children.find((c) => c.name === 'feel-splash-ring' && c.visible);
    const gator = named(fx.root, 'feel-gator') as Group;
    console.log(`[examined] splash at y 82.85: ring y ${ring?.position.y}, gator y ${gator.position.y}`);
    expect(ring?.position.y).toBeCloseTo(82.9, 6);
    expect(gator.position.y).toBeGreaterThan(80);
  });
});

describe('the chalk mark is where the sim says he will land, or not shown when there is no landing', () => {
  const flying = (over: Partial<EntitySnapshot> = {}) =>
    rider(0, {
      mode: 'Airborne',
      grounded: false,
      y: 7,
      road: { edge: 0, s: 100, d: 0, h: 7, dir: 1, yaw: 0 },
      ...over,
    });
  const TD = { x: 12, y: 3.4, z: -130, heading: 0.3, inS: 0.8, crooked: false };

  it('on a roof (the forecast’s height is the roof’s): the mark sits on it, not on the road under the truck', () => {
    const a = new AirPays();
    const s = snap([flying({ touchdown: TD })]);
    a.update(s, s, 1, 0);
    expect(a.mark.visible).toBe(true);
    expect(a.mark.position.y).toBeGreaterThan(3.4);
    expect(a.mark.position.y).toBeLessThan(3.6);
  });

  it('on the old bridge’s deck, a different height from the road he flew off: there', () => {
    const a = new AirPays();
    const s = snap([flying({ touchdown: { ...TD, y: 4.0 } })]);
    a.update(s, s, 1, 0);
    expect(a.mark.position.y).toBeCloseTo(4.04, 1);
  });

  it('a flight that ends in the sea has no forecast, so no mark (the control: the same flight with one has it)', () => {
    const none = new AirPays();
    const s = snap([flying({ touchdown: null })]);
    none.update(s, s, 1, 0);
    expect(none.mark.visible).toBe(false);
    expect(none.stats().mark).toBe(false);
    const some = new AirPays();
    const s2 = snap([flying({ touchdown: TD })]);
    some.update(s2, s2, 1, 0);
    expect(some.mark.visible).toBe(true);
  });
});
