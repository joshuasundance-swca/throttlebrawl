// The aim marker (playtest 4, P4-6, "Auto-aim + swipe": the rival a tap will hit is shown), render's
// part (aim-marker.ts). Driven by hand-built snapshots at fixed alphas (no wall clock, no frames):
// - the marker sits on the rider the SIM names (`aimId` on the player's rider) and follows him when
//   the sim names another or he moves;
// - no id, or a snapshot without that rider, shows nothing;
// - it is one mesh (at most one draw call), it faces the camera and keeps clear of the target's body.
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { AimMarker } from './aim-marker';

const entity = (over: Partial<EntitySnapshot>): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 30,
  lean: 0,
  contentId: 'base:rival',
  name: 'Rival',
  faction: 'rider',
  slot: -1,
  throttle: 1,
  rpm: 0,
  gear: 5,
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

const snap = (entities: EntitySnapshot[], tick = 1): SimSnapshot => ({
  tick,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

const me = (aimId: number) => entity({ id: 0, slot: 0, contentId: 'base:player', z: 0, aimId });
const rival = (id: number, x: number, z: number) => entity({ id, x, z, y: 2 });
const CAMERA = { x: 0, y: 3, z: 8 };

describe('P4-6: the aim marker sits on the rider the sim names', () => {
  it('shows on the previewed rider, and moves to the one the sim names next', () => {
    const marker = new AimMarker();
    const field = [rival(1, 2, -6), rival(2, -2, -9)];
    marker.update(null, snap([me(1), ...field]), 1, CAMERA);
    expect(marker.stats()).toEqual({ shown: true, target: 1 });
    expect(marker.mesh.visible).toBe(true);
    const nearFirst = marker.mesh.position.clone();
    // Over rider 1, not rider 2.
    expect(Math.hypot(nearFirst.x - 2, nearFirst.z + 6)).toBeLessThan(
      Math.hypot(nearFirst.x + 2, nearFirst.z + 9),
    );

    marker.update(null, snap([me(2), ...field]), 1, CAMERA);
    expect(marker.stats()).toEqual({ shown: true, target: 2 });
    expect(marker.mesh.position.x).toBeLessThan(0);
    expect(marker.mesh.position.distanceTo(nearFirst)).toBeGreaterThan(3);
  });

  it('follows the rider between two snapshots', () => {
    const marker = new AimMarker();
    const prev = snap([me(1), rival(1, 0, -10)]);
    const curr = snap([me(1), rival(1, 0, -20)], 2);
    marker.update(prev, curr, 0, CAMERA);
    const a = marker.mesh.position.z;
    marker.update(prev, curr, 1, CAMERA);
    const b = marker.mesh.position.z;
    expect(b).toBeLessThan(a - 8);
  });

  it('shows nothing without an id, without a player, or when the named rider is gone', () => {
    const marker = new AimMarker();
    marker.update(null, snap([me(-1), rival(1, 0, -6)]), 1, CAMERA);
    expect(marker.stats()).toEqual({ shown: false, target: -1 });
    expect(marker.mesh.visible).toBe(false);
    marker.update(null, snap([rival(1, 0, -6)]), 1, CAMERA);
    expect(marker.mesh.visible).toBe(false);
    marker.update(null, snap([me(7), rival(1, 0, -6)]), 1, CAMERA);
    expect(marker.mesh.visible).toBe(false);
    marker.update(null, null, 1, CAMERA);
    expect(marker.mesh.visible).toBe(false);
  });

  it('shows nothing on the grid while the countdown holds the sim at tick 0', () => {
    const marker = new AimMarker();
    marker.update(null, snap([me(1), rival(1, 0, -3)], 0), 1, CAMERA);
    expect(marker.mesh.visible).toBe(false);
    marker.update(null, snap([me(1), rival(1, 0, -3)], 1), 1, CAMERA);
    expect(marker.mesh.visible).toBe(true);
  });

  it('shows nothing for a snapshot that predates the field (hand-built, no aimId)', () => {
    const marker = new AimMarker();
    const bare = entity({ id: 0, slot: 0 });
    marker.update(null, snap([bare, rival(1, 0, -6)]), 1, CAMERA);
    expect(marker.mesh.visible).toBe(false);
  });

  it('is one mesh: at most one draw call', () => {
    const marker = new AimMarker();
    let meshes = 0;
    marker.root.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes++;
    });
    expect(meshes).toBe(1);
  });

  it('faces the camera, sits between the target and the camera, and grows with distance', () => {
    const marker = new AimMarker();
    marker.update(null, snap([me(1), rival(1, 0, -4)]), 1, CAMERA);
    const near = marker.mesh.scale.x;
    // Toward the camera: nearer to it than the target's own centre is.
    expect(marker.mesh.position.z).toBeGreaterThan(-4);
    // Its front (+z) points at the camera.
    const front = { x: 0, y: 0, z: 1 };
    const q = marker.mesh.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y) * front.z;
    const fy = 2 * (q.y * q.z - q.w * q.x) * front.z;
    const fz = (1 - 2 * (q.x * q.x + q.y * q.y)) * front.z;
    const toCam = {
      x: CAMERA.x - marker.mesh.position.x,
      y: CAMERA.y - marker.mesh.position.y,
      z: CAMERA.z - marker.mesh.position.z,
    };
    const len = Math.hypot(toCam.x, toCam.y, toCam.z);
    expect(fx * (toCam.x / len) + fy * (toCam.y / len) + fz * (toCam.z / len)).toBeGreaterThan(0.99);

    marker.update(null, snap([me(1), rival(1, 0, -80)]), 1, CAMERA);
    expect(marker.mesh.scale.x).toBeGreaterThan(near);
  });
});
