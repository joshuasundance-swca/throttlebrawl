// The shadow and the chalk mark on roofs and slopes (the maintainer, 2026-10-06, [decided]: a road race in a
// physical world with honest edges; "consistent physics and gameplay is important here so players know what to
// expect"). The sim's riders ride a roof and a pitched roof's slope, and a crash can rest on a roof; what the
// mark lies on is the roof the plan holds (roof-fit.ts), the same top the sim meets. Driven by hand-built snapshots
// (the same shape the sim publishes), with the plan the renderer reads handed over as it hands it to the views.
// Each mark has its control: with no plan (a menu backdrop, a replay before its first tick) it is as it was.
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot, TouchdownSnapshot } from '../sim/api';
import { AirPays } from './air-pays';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { boxAt, planOfBoxes } from './roof-fit.test-util';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';

const entity = (over: Partial<EntitySnapshot>): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 10,
  y: 0,
  z: -100,
  heading: 0,
  speed: 20,
  lean: 0,
  contentId: 'base:player',
  name: 'You',
  faction: 'rider',
  slot: 0,
  throttle: 1,
  rpm: 0,
  gear: 3,
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
});

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

// A flat roof (4 m) at x 2..18, z -110..-90, and a pitched one (eave 4 m, ridge 7 m, falling along z) beside it.
const plan = planOfBoxes([
  boxAt('flat', 10, -100, 0, 8, 10, { kind: 'flat', topM: 4 }),
  boxAt('pitched', 50, -100, 0, 8, 10, { kind: 'pitched', eaveM: 4, ridgeM: 7, ridge: 'u' }),
]);

function rig() {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
  const mesh = views.root.getObjectByName('blob-shadows');
  if (!(mesh instanceof InstancedMesh)) throw new Error('no shadow mesh');
  /** The shadows the last sync drew: where, the oval's normal (its face's), and its extents. */
  const shadows = () => {
    const out: { p: Vector3; normal: Vector3; across: number; along: number }[] = [];
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const p = new Vector3();
      m.decompose(p, q, s);
      // The circle is laid in z; its face's normal after the instance's turn.
      out.push({ p, normal: new Vector3(0, 0, 1).applyQuaternion(q), across: s.x, along: s.y });
    }
    return out;
  };
  return { views, shadows };
}

describe('the blob shadow on a roof', () => {
  const ON_SLOPE = entity({
    x: 50,
    y: 5.8,
    z: -104,
    road: { edge: 0, s: 100, d: 0, h: 5.8, dir: 1, yaw: 0 },
  });

  it('lies on a pitched roof’s plane: tilted down the slope he rides, at the roof’s height', () => {
    const { views, shadows } = rig();
    views.setStructures(plan);
    views.sync(null, snap([ON_SLOPE]), 1, 0);
    const [s] = shadows();
    console.log(
      `[examined] shadow on a 0.3 grade: normal (${s?.normal.x.toFixed(3)}, ${s?.normal.y.toFixed(3)}, ${s?.normal.z.toFixed(3)}), y ${s?.p.y.toFixed(3)}`,
    );
    // Falling 0.3 m per metre toward -z (he faces it): the normal leans uphill, +z... as a plane: nz / ny = -0.3.
    expect(s?.normal.y).toBeCloseTo(1 / Math.sqrt(1.09), 3);
    expect((s?.normal.z ?? 0) / (s?.normal.y ?? 1)).toBeCloseTo(-0.3, 3);
    expect(s?.p.y).toBeGreaterThan(5.8);
    expect(s?.p.y).toBeLessThan(5.9);
  });

  it('control: with no plan it is laid flat, as it was', () => {
    const { views, shadows } = rig();
    views.sync(null, snap([ON_SLOPE]), 1, 0);
    const [s] = shadows();
    expect(s?.normal.y).toBeCloseTo(1, 6);
    expect(s?.normal.z).toBeCloseTo(0, 6);
  });

  it('control: a rider on the road beside the building is untouched by the plan', () => {
    const { views, shadows } = rig();
    const road = entity({ x: 30, y: 0, z: -100 });
    views.setStructures(plan);
    views.sync(null, snap([road]), 1, 0);
    const withPlan = shadows()[0];
    views.setStructures(null);
    views.sync(null, snap([road]), 1, 0.1);
    const without = shadows()[0];
    expect(withPlan?.p.toArray()).toEqual(without?.p.toArray());
    expect(withPlan?.normal.toArray()).toEqual(without?.normal.toArray());
  });

  it('near an eave it is drawn smaller so none of it hangs in the air', () => {
    const { views, shadows } = rig();
    views.setStructures(plan);
    const near = entity({ x: 10, y: 4, z: -109.1, road: { edge: 0, s: 100, d: 0, h: 4, dir: 1, yaw: 0 } });
    const inside = entity({ x: 10, y: 4, z: -100, road: { edge: 0, s: 100, d: 0, h: 4, dir: 1, yaw: 0 } });
    views.sync(null, snap([inside]), 1, 0);
    const whole = shadows()[0];
    views.sync(null, snap([near]), 1, 0.1);
    const edge = shadows()[0];
    expect(edge?.along ?? 9).toBeLessThan((whole?.along ?? 0) * 0.8);
  });

  it('a body down on a roof throws its shadow on the roof, not on the road inside the building', () => {
    const { views, shadows } = rig();
    const body = (x: number, y: number, z: number) => ({ x, y, z, vx: 0, vy: 0, vz: 0 });
    const down = entity({
      mode: 'Tumble',
      grounded: false,
      x: 10,
      y: 4.3,
      z: -100,
      road: { edge: 0, s: 100, d: 0, h: 4.3, dir: 1, yaw: 0 },
      tumble: { rider: body(11, 4.3, -100), bike: body(9, 4.2, -101) },
    });
    views.sync(null, snap([down]), 1, 0);
    const old = shadows();
    expect(old.map((s) => s.p.y)).toEqual([expect.closeTo(0.04, 2), expect.closeTo(0.04, 2)]);
    views.setStructures(plan);
    views.sync(null, snap([down]), 1, 0.1);
    const roof = shadows();
    expect(roof).toHaveLength(2);
    for (const s of roof) expect(s.p.y).toBeCloseTo(4.04, 2);
  });
});

describe('the chalk mark on a roof', () => {
  const td = (over: Partial<TouchdownSnapshot> = {}): TouchdownSnapshot => ({
    x: 50,
    y: 5.8,
    z: -104,
    heading: 0,
    inS: 0.8,
    crooked: false,
    ...over,
  });
  const flying = (touchdown: TouchdownSnapshot) =>
    entity({
      mode: 'Airborne',
      grounded: false,
      y: 9,
      touchdown,
      road: { edge: 0, s: 100, d: 0, h: 3, dir: 1, yaw: 0 },
    });
  const normalOf = (a: AirPays) => new Vector3(0, 1, 0).applyQuaternion(a.mark.quaternion);

  it('lies on the roof’s plane where he will come down on a slope', () => {
    const a = new AirPays();
    a.setStructures(plan);
    const s = snap([flying(td())]);
    a.update(s, s, 1, 0);
    const n = normalOf(a);
    expect(a.mark.visible).toBe(true);
    expect(n.y).toBeCloseTo(1 / Math.sqrt(1.09), 3);
    expect(n.z / n.y).toBeCloseTo(-0.3, 3);
    expect(a.mark.position.y).toBeGreaterThan(5.8);
    expect(a.mark.position.y).toBeLessThan(5.9);
  });

  it('control: with no plan it is flat, turned along the heading as ever', () => {
    const a = new AirPays();
    const s = snap([flying(td({ heading: 0.3 }))]);
    a.update(s, s, 1, 0);
    expect(a.mark.rotation.y).toBeCloseTo(0.3);
    expect(normalOf(a).y).toBeCloseTo(1, 9);
  });

  it('control: on the road, with the plan handed over, it is flat', () => {
    const a = new AirPays();
    a.setStructures(plan);
    const s = snap([flying(td({ x: 30, y: 0, z: -100, heading: 0.3 }))]);
    a.update(s, s, 1, 0);
    expect(a.mark.rotation.y).toBeCloseTo(0.3);
    expect(normalOf(a).y).toBeCloseTo(1, 9);
  });

  it('a flat roof: flat at its height, still turned along the heading', () => {
    const a = new AirPays();
    a.setStructures(plan);
    const s = snap([flying(td({ x: 10, y: 4, z: -100, heading: 0.3 }))]);
    a.update(s, s, 1, 0);
    expect(a.mark.position.y).toBeGreaterThan(4);
    expect(a.mark.position.y).toBeLessThan(4.1);
    expect(normalOf(a).y).toBeCloseTo(1, 9);
    const forward = new Vector3(0, 0, -1).applyQuaternion(a.mark.quaternion);
    expect(Math.atan2(-forward.x, -forward.z)).toBeCloseTo(0.3, 6);
  });
});
