// Blob shadows (playtest 2, 2026-10-02: riders and bikes "blocky and uninteresting"; the art ask in
// the interview, 2026-10-02): a soft dark oval under every rider and vehicle, so they sit on the
// road instead of floating on it, and a bike in the air throws a smaller, fainter one on the ground
// below, which is how the eye judges a jump's height. One instanced mesh and one draw call for the
// whole field, however many entities there are. Code-made and flat (no textures, no shadow maps):
// cheap on the phone. Presentation only.
import {
  CircleGeometry,
  InstancedMesh,
  Group,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import type { EntitySnapshot } from '../sim/api';

/** The most shadows drawn at once (the nearest entities by snapshot order; a field is far fewer). */
export const MAX_SHADOWS = 64;

/** Opacity on the ground, and how fast it fades with height over the road (per metre). */
const OPACITY = 0.42;
const FADE_PER_M = 0.22;
/** Lift over the road, so the oval never z-fights the surface, m. */
const LIFT_M = 0.04;

/** The oval's half-extents for an entity: riders are bike-sized, vehicles take their own size. */
export interface ShadowSize {
  /** Across the heading, m. */
  widthM: number;
  /** Along the heading, m. */
  lengthM: number;
}

export const RIDER_SHADOW: ShadowSize = { widthM: 1.1, lengthM: 2.3 };
/** A rider on foot, or tumbling clear of the bike. */
export const ON_FOOT_SHADOW: ShadowSize = { widthM: 0.9, lengthM: 0.9 };
export const DEFAULT_VEHICLE_SHADOW: ShadowSize = { widthM: 1.9, lengthM: 4.4 };

export class BlobShadows {
  /** What the scene holds: a group, so a view's own children stay its instanced meshes. */
  readonly root = new Group();
  readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  private readonly yaw = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private n = 0;

  constructor() {
    // A unit circle laid flat; the instance scale makes it an oval of the entity's size.
    const g = new CircleGeometry(0.5, 14);
    this.material = new MeshBasicMaterial({
      color: '#000000',
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(g, this.material, MAX_SHADOWS);
    this.mesh.name = 'blob-shadows';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.root.name = 'shadows';
    this.root.add(this.mesh);
  }

  /** Starts a frame: clears the shadows. */
  begin(): void {
    this.n = 0;
  }

  /**
   * Adds a shadow at a world position `groundY` under an entity heading `heading`, `heightM` above
   * the ground (a bike in the air: smaller and fainter the higher it is).
   */
  add(
    x: number,
    groundY: number,
    z: number,
    heading: number,
    size: ShadowSize,
    heightM: number,
    /** A roof's plane under him (roof-fit.ts): the oval lies in it, drawn `scale` of its size. */
    roof?: { nx: number; ny: number; nz: number; scale: number },
  ): void {
    if (this.n >= MAX_SHADOWS) return;
    const k = Math.max(0.45, 1 - Math.max(0, heightM) * FADE_PER_M) * (roof?.scale ?? 1);
    this.yaw.setFromAxisAngle(this.up, heading);
    this.q.copy(this.yaw).multiply(this.flat);
    if (roof && (roof.nx !== 0 || roof.nz !== 0)) {
      // Level the flat oval, then tip it onto the roof's plane (the normal is a unit vector).
      this.tilt.setFromUnitVectors(this.up, this.v.set(roof.nx, roof.ny, roof.nz));
      this.q.premultiply(this.tilt);
    }
    this.s.set(size.widthM * k, size.lengthM * k, 1);
    this.m.compose(this.v.set(x, groundY + LIFT_M, z), this.q, this.s);
    this.mesh.setMatrixAt(this.n++, this.m);
  }

  /** Ends a frame: shows what was added. */
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** How many shadows the last frame drew. */
  get count(): number {
    return this.n;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.material as Material).dispose();
    this.mesh.dispose();
  }
}

/**
 * Ground height under an entity, world y: what it is on or over (the maintainer, 2026-10-06, "consistent
 * physics and gameplay is important here so players know what to expect").
 * - A rider riding (mode Road) is on what holds him: the road, a ramp's deck, or the roof of a truck he
 *   rides (`road.h` over the road under it): his own height, not the road far under a support.
 * - A rider in the air, or a body falling overboard, with the sim's `floorY` (the roof he is over, the sea
 *   or the drop's floor past a rail, another road's deck): that. A roof is never above him.
 * - Everything else, and a hand-built snapshot with no floor: its world y less its height over the road.
 */
export function groundYOf(e: EntitySnapshot): number {
  if (e.kind === 'rider') {
    if (e.mode === 'Road') return e.y;
    if (e.mode === 'Airborne' && e.floorY !== undefined) return Math.min(e.y, e.floorY);
    if (e.mode === 'Tumble' && e.floorY !== undefined) return e.floorY;
  }
  return e.y - Math.max(0, e.road.h);
}
