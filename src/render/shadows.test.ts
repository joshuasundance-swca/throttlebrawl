// Blob shadows (shadows.ts): a soft dark oval under every rider and vehicle, one draw call for the
// lot, smaller and fainter for a bike in the air, on the ground and not on the bike.
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { MAX_SHADOWS } from './shadows';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';

const entity = (over: Partial<EntitySnapshot>): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 10,
  y: 4,
  z: -100,
  heading: 0,
  speed: 25,
  lean: 0,
  contentId: 'base:r0',
  name: 'r0',
  faction: 'rider',
  slot: 0,
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
});

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

function rig() {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
  const mesh = views.root.getObjectByName('blob-shadows');
  if (!(mesh instanceof InstancedMesh)) throw new Error('no shadow mesh');
  /** The shadows the last sync drew: position and the oval's across / along extents. */
  const shadows = () => {
    const out: { p: Vector3; across: number; along: number }[] = [];
    const m = new Matrix4();
    const q = new Quaternion();
    const s = new Vector3();
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m);
      const p = new Vector3();
      m.decompose(p, q, s);
      out.push({ p, across: s.x, along: s.y });
    }
    return out;
  };
  return { views, mesh, shadows };
}

describe('blob shadows', () => {
  it('puts one oval on the ground under a rider, longer along the bike than across it', () => {
    const { views, mesh, shadows } = rig();
    views.sync(null, snap([entity({})]), 1, 0);
    expect(mesh.visible).toBe(true);
    const [s] = shadows();
    expect(shadows()).toHaveLength(1);
    expect(s?.p.x).toBeCloseTo(10);
    expect(s?.p.z).toBeCloseTo(-100);
    expect(s?.p.y).toBeGreaterThan(4); // just over the road surface (y = 4 here), never under it
    expect(s?.p.y).toBeLessThan(4.1);
    expect((s?.along ?? 0) / (s?.across ?? 1)).toBeGreaterThan(1.5);
  });

  it('draws one mesh for the whole field: riders and vehicles together', () => {
    const { views, mesh, shadows } = rig();
    const field = [
      entity({ id: 0 }),
      entity({ id: 1, x: 14, slot: -1 }),
      entity({ id: 2, kind: 'vehicle', contentId: 'base:sedan', x: 6 }),
      entity({ id: 3, kind: 'vehicle', contentId: 'base:truck', x: 2 }),
      entity({ id: 4, kind: 'ped', contentId: 'base:tourist', x: -3 }),
    ];
    views.sync(null, snap(field), 1, 0);
    // The riders and vehicles, not the pedestrian.
    expect(shadows()).toHaveLength(4);
    const named: unknown[] = [];
    views.root.traverse((o) => {
      if (o.name === 'blob-shadows') named.push(o);
    });
    expect(named).toEqual([mesh]);
    expect(mesh.count).toBe(4);
  });

  it('puts a bike in the air back on the ground, smaller than when it is down', () => {
    const { views, shadows } = rig();
    views.sync(null, snap([entity({})]), 1, 0);
    const down = shadows()[0];
    // Three metres up, in the air: the entity's y includes the height, the road surface stays where it was
    // (a snapshot with no `floorY`: the road under him). A rider RIDING up there, mode Road, is on a roof
    // or a deck, and the shadow is on that (tests high-fall).
    const flying = {
      mode: 'Airborne' as const,
      grounded: false,
      y: 7,
      road: { edge: 0, s: 100, d: 0, h: 3, dir: 1 as const, yaw: 0 },
    };
    views.sync(null, snap([entity(flying)]), 1, 0.1);
    const up = shadows()[0];
    expect(up?.p.y).toBeCloseTo(down?.p.y ?? 0, 3);
    expect(up?.across ?? 9).toBeLessThan(down?.across ?? 0);
  });

  it('gives a tumbling rider and bike a shadow each, and empties when nobody is there', () => {
    const { views, mesh, shadows } = rig();
    const body = (x: number, y: number, z: number) => ({ x, y, z, vx: 5, vy: 0, vz: -5 });
    views.sync(
      null,
      snap([entity({ mode: 'Tumble', tumble: { rider: body(11, 6, -104), bike: body(9, 5, -108) } })]),
      1,
      0,
    );
    const two = shadows();
    expect(two).toHaveLength(2);
    expect(two.map((s) => Math.round(s.p.x)).sort((a, b) => a - b)).toEqual([9, 11]);
    views.sync(null, snap([]), 1, 0.2);
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
  });

  it('never draws more than its cap, however many entities there are', () => {
    const { views, mesh } = rig();
    const many = Array.from({ length: MAX_SHADOWS + 20 }, (_, i) =>
      entity({ id: i, kind: 'vehicle', contentId: 'base:sedan', x: i, slot: -1 }),
    );
    views.sync(null, snap(many), 1, 0);
    expect(mesh.count).toBe(MAX_SHADOWS);
  });
});
