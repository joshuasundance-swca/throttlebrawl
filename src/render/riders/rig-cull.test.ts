// A rider rig the view cannot see is not drawn (polish J3, punch item 1). The busiest Bridge City frame measured live
// (seed 3, Broadway South, tick 5472: the takedown framing, aimed down a side street) drew 112 of the 120 draw calls,
// 9 of them rider rigs: a rig's mesh is one skinned mesh with `frustumCulled = false` (its bounds are the bind pose's,
// which a posed rider leaves), so it drew whether or not the camera faced it. The rig is now shown only while a sphere
// round the rider and the bike touches the camera's frustum (RiderRigs.setView).
// The rig is driven the way the game drives it (EntityViews + RiderRigs on hand-built baked parts, no WebGL).
import { Frustum, Matrix4, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import { frustumOf } from '../view-frustum';
import { EntityViews } from '../views';
import { RIG_CULL_RADIUS_M, RiderRigs } from './index';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

const ID = 'base:player';

function rider(id: number, x: number, z: number, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x,
    y: 0,
    z,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId: ID,
    name: `rider ${id}`,
    faction: 'rider',
    slot: id,
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
    distanceToFinish: 0,
    place: 1,
    finished: false,
    ...over,
  };
}

function world() {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const views = new EntityViews(look, { params });
  const rigs = new RiderRigs(look, null, params);
  views.setRigs(rigs);
  rigs.addPart('models/riders/player', fakeRider());
  rigs.addPart('models/bikes/sport', fakeBike());
  rigs.setLooks([
    riderLookOf({ contentId: ID, role: 'rival', bikeId: 'base:sport', look: { bikeModel: 'sport' } }),
  ]);
  let tick = 0;
  /** One frame of these riders; true while a rider's rig mesh is shown (by rider id). */
  const frame = (entities: EntitySnapshot[]): Map<number, boolean> => {
    const curr = { tick, timeScale: 1, entities } as unknown as SimSnapshot;
    views.sync(null, curr, 1, tick / 60);
    tick++;
    const shown = new Map<number, boolean>();
    rigs.root.updateMatrixWorld(true);
    // The rig meshes are named alike: they come in the order the riders were first drawn.
    const meshes: boolean[] = [];
    rigs.root.traverse((o) => {
      if (o.name === 'rig-mesh') meshes.push(o.visible);
    });
    entities.forEach((e, i) => shown.set(e.id, meshes[i] ?? false));
    return shown;
  };
  return { rigs, frame };
}

/** A camera at the origin looking down -z, as the phone sees (915 x 412), the way the renderer sets it up. */
function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 915 / 412, 0.3, 760);
  cam.position.set(0, 3, 0);
  cam.lookAt(0, 1, -30);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

describe('a rig the camera cannot see is not drawn', () => {
  const ahead = rider(0, 0, -20);
  const behind = rider(1, 0, 25);
  const wide = rider(2, 60, -10);

  it('draws every rig while no view is set (the old behaviour)', () => {
    const w = world();
    const shown = w.frame([ahead, behind, wide]);
    expect([...shown.values()]).toEqual([true, true, true]);
  });

  it('draws the rider ahead, and leaves out the one behind the camera and the one far off to the side', () => {
    const w = world();
    w.rigs.setView(frustumOf(camera()));
    const shown = w.frame([ahead, behind, wide]);
    expect(shown.get(0)).toBe(true);
    expect(shown.get(1)).toBe(false);
    expect(shown.get(2)).toBe(false);
  });

  it('shows a rig again the frame it comes back into view', () => {
    const w = world();
    w.rigs.setView(frustumOf(camera()));
    expect(w.frame([rider(0, 0, 25)]).get(0)).toBe(false);
    expect(w.frame([rider(0, 0, -25)]).get(0)).toBe(true);
    expect(w.frame([rider(0, 0, 25)]).get(0)).toBe(false);
  });

  it('keeps a rig whose centre is just out of the frame but whose bike and limbs reach in (the margin is real)', () => {
    const cam = camera();
    const f = frustumOf(cam);
    // The left edge of the view at 20 m ahead: find the lateral position where the centre leaves the frustum.
    let edge = 0;
    for (let x = 0; x < 200; x += 0.25) {
      edge = x;
      if (!f.containsPoint({ x: -x, y: 1, z: -20 } as never)) break;
    }
    const w = world();
    w.rigs.setView(f);
    const just = w.frame([rider(0, -(edge + RIG_CULL_RADIUS_M * 0.5), -20)]).get(0);
    expect(just, 'half the radius outside the edge').toBe(true);
    const far = world();
    far.rigs.setView(f);
    expect(far.frame([rider(0, -(edge + RIG_CULL_RADIUS_M * 3), -20)]).get(0), 'three radii outside').toBe(
      false,
    );
  });

  it('negative control: the same frustum and a plain sphere test agree, so the test could have failed', () => {
    // frustumOf is the camera's own frustum: a point straight ahead is in it, one straight behind is not.
    const f = frustumOf(camera());
    expect(f.containsPoint({ x: 0, y: 1, z: -20 } as never)).toBe(true);
    expect(f.containsPoint({ x: 0, y: 1, z: 25 } as never)).toBe(false);
    const manual = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera().projectionMatrix, camera().matrixWorldInverse),
    );
    expect(f.planes.map((p) => p.constant.toFixed(4))).toEqual(
      manual.planes.map((p) => p.constant.toFixed(4)),
    );
  });
});
