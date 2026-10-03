// Airboats running alongside (run W-U; the pitch deck's #7, the Keys' rest: "a mangrove boardwalk
// with airboats alongside"; interview, 2026-10-02, round 2: "mangrove back roads (airboats, gators,
// shacks)"). A road side tagged `airboats` (the Keys' Mangrove Boardwalk, its right side: the open
// channel between it and the Mangrove Bend) gets a few tour airboats out on the water. With nobody
// near they cruise up and down the channel; when the player rides that road they run alongside,
// each a little ahead or behind, surging and dropping back, and come round at the channel's ends.
// Code-made, flat-coloured boxes (every look recolours them through the `vehicle` material), one
// instanced mesh: one draw call, and none while they are out of view. A lazy chunk, loaded only for
// a road that has the tag. Presentation only: nothing here reaches the sim, so frame time is fine.
import { Group, InstancedMesh, Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import type { RoadNetwork, SimSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import type { LookStyle } from './look';
import type { RoadDressing, TagSpan } from './road-mesh';
import { boatBob } from './scenery';

/** One stretch of a road side the airboats run along. */
export interface AirboatRun {
  edge: number;
  s0: number;
  s1: number;
  side: -1 | 1;
}

/** Airboats per run. [default] */
export const AIRBOATS_PER_RUN = 3;
/** Each boat's distance out from the road's outer edge, m: inside the channel, clear of the far road. */
export const AIRBOAT_OFFSETS_M: readonly number[] = [6, 10.5, 8];
/** How far ahead (+) or behind (-) of the player each boat runs alongside, m. [default] */
const LEADS_M: readonly number[] = [-14, 9, 26];
/** The surge: how far each boat drifts ahead and back while pacing, m, and how fast, rad/s. */
const SURGE_M = 9;
const SURGE_RATE = 0.55;
/** Top speed over the water, m/s (faster than any bike, so it can catch you up). [default] */
export const AIRBOAT_MAX_MPS = 58;
/** Cruising speed with nobody to pace, m/s. [default] */
export const AIRBOAT_CRUISE_MPS = 12;
/** How far past the run's ends a rider still has the boats' attention, m. */
const PACE_REACH_M = 40;

/** The road sides tagged `airboats`, as runs along their edges. */
export function airboatRuns(road: RoadNetwork, dressing: RoadDressing | undefined): AirboatRun[] {
  const out: AirboatRun[] = [];
  for (const e of road.edges) {
    const tags = dressing?.[e.id]?.tags ?? (e as unknown as { tags?: readonly TagSpan[] }).tags ?? [];
    for (const t of tags) {
      if (t.tag !== 'airboats') continue;
      const s0 = Math.max(0, t.s0);
      const s1 = Math.min(e.length, t.s1);
      if (s1 - s0 < 20) continue;
      const sides: (-1 | 1)[] = t.side === 'left' ? [-1] : t.side === 'right' ? [1] : [-1, 1];
      for (const side of sides) out.push({ edge: e.index, s0, s1, side });
    }
  }
  return out;
}

const box = (
  size: readonly [number, number, number],
  at: readonly [number, number, number],
  color: string,
  rotX = 0,
) => ({ size, at, color, rotX }) as BoxPart;

/**
 * A tour airboat, facing -z, its waterline at y 0: a flat white hull with a raised bow, the driver up
 * on his high seat, a bench of tourists in loud shirts, and the big caged fan at the stern with its
 * rudders. Larger than life by a little, so it reads across the channel at speed.
 */
export function airboatParts(): BoxPart[] {
  const HULL = '#eef0ea';
  const STRIPE = '#2a9d8f';
  const CAGE = '#2d2f33';
  const SEAT = '#d1495b';
  return [
    box([2.6, 0.4, 5.2], [0, 0.2, 0.2], HULL),
    box([2.6, 0.32, 1.4], [0, 0.42, -2.75], HULL, -0.32),
    box([2.64, 0.12, 5.2], [0, 0.34, 0.2], STRIPE),
    // A bench of tourists (two loud shirts and a hat) facing forward.
    box([2.0, 0.35, 0.6], [0, 0.6, -0.9], SEAT),
    box([0.5, 0.75, 0.42], [-0.55, 1.15, -0.9], '#f2c14e'),
    box([0.5, 0.75, 0.42], [0.55, 1.15, -0.9], '#57b6c9'),
    box([0.42, 0.34, 0.42], [-0.55, 1.7, -0.9], '#e8b98f'),
    box([0.42, 0.34, 0.42], [0.55, 1.7, -0.9], '#c98f6b'),
    box([0.62, 0.12, 0.62], [0.55, 1.92, -0.9], '#f4f1e6'),
    // The driver's high seat on its frame, and the driver.
    box([0.9, 1.3, 0.8], [0, 1.05, 0.55], '#c7c9c4'),
    box([0.8, 0.2, 0.7], [0, 1.8, 0.55], SEAT),
    box([0.55, 0.8, 0.42], [0, 2.3, 0.55], '#3c6e47'),
    box([0.4, 0.36, 0.4], [0, 2.88, 0.55], '#e8b98f'),
    // The fan cage: a dark ring of four bars round the prop, the prop's blades, two rudders.
    box([2.5, 0.16, 0.16], [0, 3.35, 1.95], CAGE),
    box([2.5, 0.16, 0.16], [0, 1.0, 1.95], CAGE),
    box([0.16, 2.5, 0.16], [-1.17, 2.18, 1.95], CAGE),
    box([0.16, 2.5, 0.16], [1.17, 2.18, 1.95], CAGE),
    box([2.0, 0.22, 0.06], [0, 2.18, 1.88], '#8a6a46'),
    box([0.5, 0.5, 0.5], [0, 2.18, 1.6], CAGE),
    box([0.08, 1.1, 0.7], [-0.6, 1.6, 2.55], CAGE),
    box([0.08, 1.1, 0.7], [0.6, 1.6, 2.55], CAGE),
  ];
}

/** Where a pacing boat wants to be along its run: the player's s, its lead, and the surge. */
export function paceTarget(playerS: number, k: number, t: number): number {
  const lead = LEADS_M[k % LEADS_M.length] ?? 0;
  return playerS + lead + SURGE_M * Math.sin(SURGE_RATE * t + k * 2.1);
}

/** A cruising boat's s at time t: up and down the run at the cruising speed (a triangle wave). */
export function cruiseAt(run: AirboatRun, k: number, t: number): { s: number; dir: 1 | -1 } {
  const span = Math.max(1, run.s1 - run.s0);
  const u = (t * AIRBOAT_CRUISE_MPS + (k * span * 2) / AIRBOATS_PER_RUN) % (2 * span);
  return u < span ? { s: run.s0 + u, dir: 1 } : { s: run.s1 - (u - span), dir: -1 };
}

/** What the last frame drew, for tests and the dev handle. */
export interface AirboatCounts {
  runs: number;
  boats: number;
  /** Boats pacing the player in the last frame. */
  pacing: number;
}

interface Boat {
  run: AirboatRun;
  k: number;
  s: number;
  dir: 1 | -1;
}

export class AirboatLayer {
  readonly group = new Group();
  private readonly mesh: InstancedMesh | null;
  private readonly geometry: BufferGeometry;
  private readonly boats: Boat[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly q2 = new Quaternion();
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly zAxis = new Vector3(0, 0, 1);
  private readonly xAxis = new Vector3(1, 0, 0);
  private last: AirboatCounts = { runs: 0, boats: 0, pacing: 0 };

  constructor(
    private readonly road: RoadNetwork,
    look: LookStyle,
    runs: readonly AirboatRun[],
  ) {
    this.group.name = 'airboats';
    this.geometry = mergeBoxes(airboatParts());
    runs.forEach((run) => {
      for (let k = 0; k < AIRBOATS_PER_RUN; k++) {
        const c = cruiseAt(run, k, 0);
        this.boats.push({ run, k, s: c.s, dir: c.dir });
      }
    });
    if (this.boats.length === 0) {
      this.mesh = null;
      return;
    }
    const mesh = new InstancedMesh(
      this.geometry,
      look.material('vehicle', { vertexColors: true }),
      this.boats.length,
    );
    mesh.name = 'airboats';
    this.mesh = mesh;
    this.group.add(mesh);
    this.last = { runs: runs.length, boats: this.boats.length, pacing: 0 };
  }

  /**
   * Moves the boats to frame time `t` (seconds; `dt` scaled by the race's time scale, so they hang
   * in a takedown's slow motion) and poses them. `snap`'s player (slot 0) is the one they pace.
   */
  update(snap: SimSnapshot | null, t: number, dt: number): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const me = snap?.entities.find((e) => e.slot === 0);
    let pacing = 0;
    this.boats.forEach((b, i) => {
      const run = b.run;
      const onRun =
        me &&
        me.road.edge === run.edge &&
        me.road.s > run.s0 - PACE_REACH_M &&
        me.road.s < run.s1 + PACE_REACH_M;
      let target: number;
      if (onRun) {
        target = paceTarget(me.road.s, b.k, t);
        pacing++;
      } else {
        target = cruiseAt(run, b.k, t).s;
      }
      target = Math.min(run.s1, Math.max(run.s0, target));
      const step = AIRBOAT_MAX_MPS * Math.max(0, dt);
      const ds = Math.max(-step, Math.min(step, target - b.s));
      if (Math.abs(ds) > 0.02) b.dir = ds > 0 ? 1 : -1;
      // On the first frame (and after a long gap) the boats are simply where they want to be.
      b.s = dt <= 0 || dt > 0.5 ? target : b.s + ds;
      const edge = this.road.edges[run.edge];
      if (!edge) return;
      const outer = run.side > 0 ? edge.dMax : -edge.dMin;
      const d = run.side * (outer + 0.6 + (AIRBOAT_OFFSETS_M[b.k % AIRBOAT_OFFSETS_M.length] ?? 8));
      const p = this.road.toWorld(run.edge, b.s, d, 0);
      const ahead = this.road.toWorld(run.edge, Math.min(edge.length, b.s + 1), d, 0);
      const behind = this.road.toWorld(run.edge, Math.max(0, b.s - 1), d, 0);
      // The model faces -z: turn it to face its way along the road.
      const fx = (ahead.x - behind.x) * b.dir;
      const fz = (ahead.z - behind.z) * b.dir;
      const heading = Math.atan2(-fx, -fz);
      const bob = boatBob(t * 1.6, i * 1.3);
      this.q.setFromAxisAngle(this.yAxis, heading);
      // Planing: the bow up a little at speed, and the swell's roll.
      this.q2.setFromAxisAngle(
        this.xAxis,
        Math.min(0.12, Math.abs(ds) / Math.max(dt, 1e-3) / 400) + bob.pitch,
      );
      this.q.multiply(this.q2);
      this.q2.setFromAxisAngle(this.zAxis, bob.roll);
      this.q.multiply(this.q2);
      this.v.set(p.x, 0.05 + bob.rise * 0.5, p.z);
      mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.one));
    });
    mesh.count = this.boats.length;
    mesh.instanceMatrix.needsUpdate = true;
    // Culled as a whole when the channel is out of view.
    mesh.computeBoundingSphere();
    this.last = { ...this.last, pacing };
  }

  counts(): AirboatCounts {
    return this.last;
  }

  /** Where each boat is, for tests: its run's edge, s and world position. */
  positions(): { edge: number; s: number; x: number; z: number }[] {
    const out: { edge: number; s: number; x: number; z: number }[] = [];
    const mesh = this.mesh;
    if (!mesh) return out;
    this.boats.forEach((b, i) => {
      mesh.getMatrixAt(i, this.m);
      this.v.setFromMatrixPosition(this.m);
      out.push({ edge: b.run.edge, s: b.s, x: this.v.x, z: this.v.z });
    });
    return out;
  }

  dispose(): void {
    this.geometry.dispose();
    this.group.removeFromParent();
    this.mesh?.dispose();
  }
}
