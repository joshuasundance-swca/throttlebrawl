// The aim marker (playtest 4, P4-6, [decided] "Auto-aim + swipe": a tap hits the closest rival on
// either side, and "the rival it would hit is shown"): four amber corner brackets around the rider the
// player's next tap will hit, so the player sees the auto-aim before pressing and can swipe for the
// other side when it is wrong.
// - The rider is the sim's, never render's own guess: `EntitySnapshot.aimId` on the player's rider
//   (sim/combat's `aimPreview`, the very rule the press uses). No id, no marker.
// - It turns to face the camera, sits a little toward the camera so the target's own body never
//   covers it, grows with distance so it stays legible on a small phone, and draws over the scene
//   (no depth test), so a rival behind a truck still shows who the tap would hit.
// Code-made and flat: one mesh, so one draw call while it shows and none while it does not.
// Presentation only: it reads snapshots, never sim state.
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';

/** The marker's colour: amber, which no rider, bike or sign in the packs uses as a flat colour. */
export const AIM_COLOR = '#ffb02e';
/** Half the bracket square's side, one bracket arm's length and its thickness, m at scale 1. */
const HALF_M = 0.95;
const ARM_M = 0.4;
const LINE_M = 0.11;
/** The marker is centred this high over the target's road position, m (about a rider's chest). */
const CHEST_M = 0.95;
/** It sits this far toward the camera, m, so the target's body never covers it. */
const TOWARD_CAMERA_M = 1.2;
/** The scale grows with distance (m) from 1 at close range to a cap, so it stays legible far off. */
const SCALE_NEAR_M = 8;
const SCALE_PER_M = 0.04;
const SCALE_MAX = 2.4;

/** The four corner brackets, flat in the x-y plane facing +z. */
export function aimMarkerGeometry(): BufferGeometry {
  const pos: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number) => {
    pos.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
  };
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const cx = sx * HALF_M;
      const cy = sy * HALF_M;
      // The corner's two arms, drawn inward from the corner.
      const [xa, xb] = [cx, cx - sx * ARM_M].sort((a, b) => a - b) as [number, number];
      const [ya, yb] = [cy, cy - sy * LINE_M].sort((a, b) => a - b) as [number, number];
      quad(xa, ya, xb, yb);
      const [xc, xd] = [cx, cx - sx * LINE_M].sort((a, b) => a - b) as [number, number];
      const [yc, yd] = [cy, cy - sy * ARM_M].sort((a, b) => a - b) as [number, number];
      quad(xc, yc, xd, yd);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** What the last frame drew, for tests and the debug overlay. */
export interface AimMarkerCounts {
  shown: boolean;
  /** The rider the marker sits on, or -1. */
  target: number;
}

export class AimMarker {
  readonly root = new Group();
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private counts: AimMarkerCounts = { shown: false, target: -1 };

  constructor() {
    this.root.name = 'aim-marker';
    this.material = new MeshBasicMaterial({
      color: AIM_COLOR,
      transparent: true,
      opacity: 0.92,
      side: DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(aimMarkerGeometry(), this.material);
    this.mesh.name = 'aim-marker-brackets';
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.root.add(this.mesh);
  }

  /**
   * Updates from the snapshots: `alpha` interpolates the target between them, `camera` is where the
   * camera is (world metres), which the marker faces and keeps its distance scale from.
   */
  update(
    prev: SimSnapshot | null,
    curr: SimSnapshot | null,
    alpha: number,
    camera: { x: number; y: number; z: number },
  ): void {
    // The countdown holds the sim at tick 0: nobody can swing yet, so nobody is marked on the grid.
    const me =
      curr && curr.tick > 0 ? curr.entities.find((e) => e.kind === 'rider' && e.slot === 0) : undefined;
    const id = me?.aimId ?? -1;
    const target = id >= 0 ? curr?.entities.find((e) => e.id === id) : undefined;
    if (!target) {
      this.mesh.visible = false;
      this.counts = { shown: false, target: -1 };
      return;
    }
    const was = prev?.entities.find((e) => e.id === id);
    const at = lerpedPos(was, target, alpha);
    const dx = camera.x - at.x;
    const dy = camera.y - (at.y + CHEST_M);
    const dz = camera.z - at.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const k = Math.min(TOWARD_CAMERA_M, dist * 0.5) / dist;
    this.mesh.position.set(at.x + dx * k, at.y + CHEST_M + dy * k, at.z + dz * k);
    this.mesh.scale.setScalar(Math.min(SCALE_MAX, 1 + Math.max(0, dist - SCALE_NEAR_M) * SCALE_PER_M));
    this.mesh.lookAt(camera.x, camera.y, camera.z);
    this.mesh.visible = true;
    this.counts = { shown: true, target: id };
  }

  /** What the last frame drew. */
  stats(): AimMarkerCounts {
    return { ...this.counts };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

function lerpedPos(
  a: EntitySnapshot | undefined,
  b: EntitySnapshot,
  alpha: number,
): { x: number; y: number; z: number } {
  const from = a ?? b;
  const t = Math.min(1, Math.max(0, alpha));
  return {
    x: from.x + (b.x - from.x) * t,
    y: from.y + (b.y - from.y) * t,
    z: from.z + (b.z - from.z) * t,
  };
}
