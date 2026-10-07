// Air that pays (the pitch deck's #13, run W-T), what render draws of it:
// - the chalk mark: "a chalk mark shows where you'll touch down, red if you're crooked". While the
//   player is in the air, a chalk ring with a cross sits flat on the ground at the sim's forecast
//   touch-down point (`EntitySnapshot.touchdown`), turned along the bike's heading there: chalk white
//   for a clean landing, red when landing now would be crooked;
// - the newspaper: while the player's rider sits back reading it (`trick: 'newspaper'`), the paper is
//   held up in front of him; landing with it (a crash whose `data.attempt` is `newspaper`), it flies
//   off down the road.
// The landing one-liner is not drawn here any more (playtest 3, the maintainer: "The black and white
// text pop-ups block the actual game"): app/ puts it on the top ticker (app/ticker-feed.ts).
// Code-made and flat: one draw call for the mark and one for the paper, each only while it shows.
// Presentation only: it reads snapshots and events, never sim state.
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { StructurePlan } from '../road';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../sim/api';
import { mergeBoxes, type BoxPart } from './geometry';
import { fitRoof } from './roof-fit';
import { groundYOf } from './shadows';

/** The chalk's colours: clean, and crooked. */
export const CHALK_CLEAN = '#f3efe2';
export const CHALK_CROOKED = '#e8392c';
/** The mark's ring radius and line width, m; lifted this far over the road so it never z-fights. */
const RING_R = 0.75;
const LINE_W = 0.11;
const LIFT_M = 0.05;
/** The paper is held this high and this far ahead of the rider's road position, m. */
const PAPER_UP_M = 1.4;
const PAPER_AHEAD_M = 0.55;

/** The chalk mark's geometry: a ring and a cross, flat in the x-z plane (y up). */
export function chalkMarkGeometry(): BufferGeometry {
  const pos: number[] = [];
  const quad = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cx: number,
    cz: number,
    dx: number,
    dz: number,
  ) => {
    pos.push(ax, 0, az, bx, 0, bz, cx, 0, cz, ax, 0, az, cx, 0, cz, dx, 0, dz);
  };
  const N = 28;
  const r0 = RING_R - LINE_W / 2;
  const r1 = RING_R + LINE_W / 2;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const b = ((i + 1) / N) * Math.PI * 2;
    const [ca, sa, cb, sb] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    quad(ca * r0, sa * r0, cb * r0, sb * r0, cb * r1, sb * r1, ca * r1, sa * r1);
  }
  // The cross: two strokes through the centre, at 45 degrees to the heading.
  const h = RING_R * 0.85;
  const w = LINE_W / 2;
  for (const s of [1, -1]) {
    const ux = Math.SQRT1_2 * s;
    const uz = Math.SQRT1_2;
    const nx = -uz;
    const nz = ux;
    quad(
      -ux * h - nx * w,
      -uz * h - nz * w,
      ux * h - nx * w,
      uz * h - nz * w,
      ux * h + nx * w,
      uz * h + nz * w,
      -ux * h + nx * w,
      -uz * h + nz * w,
    );
  }
  // A short tick ahead of the ring: which way the bike will be heading (models face -z).
  quad(-w, -r1, w, -r1, w, -r1 - 0.45, -w, -r1 - 0.45);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return g;
}

/** The newspaper: a cream broadsheet with a headline bar and columns, facing +z (toward the rider). */
export function newspaperParts(): BoxPart[] {
  const ink = '#2a2a2a';
  const parts: BoxPart[] = [{ size: [0.62, 0.42, 0.012], at: [0, 0, 0], color: '#ece6d2' }];
  parts.push({ size: [0.52, 0.07, 0.004], at: [0, 0.14, 0.008], color: ink });
  for (const x of [-0.18, 0, 0.18])
    parts.push({ size: [0.14, 0.2, 0.004], at: [x, -0.05, 0.008], color: '#8d877a' });
  // The back page faces the road too: the same headline bar.
  parts.push({ size: [0.52, 0.07, 0.004], at: [0, 0.14, -0.008], color: ink });
  return parts;
}

/** What the last frame drew, for tests and the debug overlay. */
export interface AirPaysCounts {
  mark: boolean;
  crooked: boolean;
  paper: boolean;
}

interface Flying {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  ground: number;
  restS: number;
}

export class AirPays {
  readonly root = new Group();
  readonly mark: Mesh;
  readonly paper: Mesh;
  private readonly markMat: MeshBasicMaterial;
  private readonly clean = new Color(CHALK_CLEAN);
  private readonly crookedColor = new Color(CHALK_CROOKED);
  private structures: StructurePlan | null = null;
  private readonly up = new Vector3(0, 1, 0);
  private readonly normal = new Vector3();
  private readonly tilt = new Quaternion();
  private readonly level = new Quaternion();
  private pendingCrash: SimEvent[] = [];
  private flying: Flying | null = null;
  private lastT = -1;
  private counts: AirPaysCounts = { mark: false, crooked: false, paper: false };

  constructor() {
    this.root.name = 'air-pays';
    this.markMat = new MeshBasicMaterial({
      color: CHALK_CLEAN,
      transparent: true,
      opacity: 0.88,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.mark = new Mesh(chalkMarkGeometry(), this.markMat);
    this.mark.name = 'chalk-mark';
    this.mark.renderOrder = 2;
    this.mark.frustumCulled = false;
    this.mark.visible = false;
    this.paper = new Mesh(mergeBoxes(newspaperParts()), new MeshBasicMaterial({ vertexColors: true }));
    this.paper.name = 'newspaper';
    this.paper.visible = false;
    this.root.add(this.mark, this.paper);
  }

  /** The region's live  }

  /** The race's structures plan, once there is one: the mark lies on a roof (see `updateMark`). Null: the ground. */
  setStructures(plan: StructurePlan | null): void {
    this.structures = plan;
  }

  /** Sim events: a newspaper crash (the paper flies off). */
  pushEvents(events: readonly SimEvent[]): void {
    for (const e of events) {
      if (e.type === 'crash' && e.data['attempt'] === 'newspaper') this.pendingCrash.push(e);
    }
  }

  /**
   * Updates from the snapshots: `alpha` interpolates the player between them, `timeS` is wall-clock
   * seconds (the paper's flight crawls with the world's time scale).
   */
  update(prev: SimSnapshot | null, curr: SimSnapshot | null, alpha: number, timeS: number): void {
    const dt = this.lastT < 0 ? 0 : Math.min(0.1, Math.max(0, timeS - this.lastT)) * (curr?.timeScale ?? 1);
    this.lastT = timeS;
    const me = curr?.entities.find((e) => e.kind === 'rider' && e.slot === 0);
    const was = me ? prev?.entities.find((e) => e.id === me.id) : undefined;
    const pose = me ? lerped(was ?? me, me, alpha) : null;
    this.updateMark(me, was, alpha);
    this.updatePaper(me, pose, dt);
  }

  private updateMark(me: EntitySnapshot | undefined, was: EntitySnapshot | undefined, alpha: number): void {
    const td = me?.mode === 'Airborne' ? me.touchdown : null;
    if (!td || !(td.inS > 0)) {
      this.mark.visible = false;
      this.counts.mark = false;
      return;
    }
    const from = was?.touchdown ?? td;
    const t = Math.min(1, Math.max(0, alpha));
    const x = from.x + (td.x - from.x) * t;
    const y = from.y + (td.y - from.y) * t;
    const z = from.z + (td.z - from.z) * t;
    // On a roof (the maintainer, 2026-10-06: "land on it and ride on it"): the mark lies in the roof's plane, as
    // the sim's forecast reads the same roof, so on a pitched one it is not sunk into the slope; one that would
    // hang over the eave is drawn smaller. Off any roof it is flat on the ground as ever.
    const roof = this.structures
      ? fitRoof(this.structures, x, y, z, td.heading, RING_R * 2, RING_R * 2)
      : null;
    if (roof) {
      this.mark.position.set(x, roof.y + LIFT_M, z);
      this.tilt.setFromAxisAngle(this.up, td.heading);
      if (roof.nx !== 0 || roof.nz !== 0)
        this.tilt.premultiply(
          this.level.setFromUnitVectors(this.up, this.normal.set(roof.nx, roof.ny, roof.nz)),
        );
      this.mark.quaternion.copy(this.tilt);
      this.mark.scale.set(roof.scale, 1, roof.scale);
    } else {
      this.mark.position.set(x, y + LIFT_M, z);
      this.mark.rotation.set(0, td.heading, 0);
      this.mark.scale.set(1, 1, 1);
    }
    this.markMat.color.copy(td.crooked ? this.crookedColor : this.clean);
    // It firms up as the ground comes near (faint at the top of a long jump).
    this.markMat.opacity = 0.55 + 0.35 * Math.min(1, Math.max(0, 1 - td.inS / 1.5));
    this.mark.visible = true;
    this.counts.mark = true;
    this.counts.crooked = td.crooked;
  }

  private updatePaper(me: EntitySnapshot | undefined, pose: Pose | null, dt: number): void {
    for (const e of this.pendingCrash) {
      if (!me || e.actor !== me.id || !pose) continue;
      // Landed holding the newspaper: off it goes, forward and up, spinning.
      const fx = -Math.sin(pose.heading);
      const fz = -Math.cos(pose.heading);
      const at = this.paperAt(pose);
      this.flying = {
        ...at,
        vx: fx * me.speed * 0.6,
        vy: 4,
        vz: fz * me.speed * 0.6,
        spin: 9,
        ground: pose.y - (me.y - groundYOf(me)),
        restS: 0,
      };
    }
    this.pendingCrash = [];
    const f = this.flying;
    if (f) {
      f.vy -= 9.8 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      if (f.y < f.ground + 0.05) {
        f.y = f.ground + 0.05;
        f.vx *= 0.5;
        f.vz *= 0.5;
        f.vy = 0;
        f.spin *= 0.5;
        f.restS += dt;
      }
      this.paper.position.set(f.x, f.y, f.z);
      this.paper.rotation.x += f.spin * dt;
      this.paper.rotation.y += f.spin * 0.6 * dt;
      this.paper.visible = true;
      this.counts.paper = true;
      if (f.restS > 2.5) this.flying = null;
      return;
    }
    const reading = me?.mode === 'Airborne' && me.trick === 'newspaper' && pose;
    this.paper.visible = !!reading;
    this.counts.paper = !!reading;
    if (!reading || !pose) return;
    const at = this.paperAt(pose);
    this.paper.position.set(at.x, at.y, at.z);
    // Facing the rider, tipped back a little toward his eyes.
    this.paper.rotation.set(0, 0, 0);
    this.paper.rotation.order = 'YXZ';
    this.paper.rotation.y = pose.heading;
    this.paper.rotation.x = -0.35;
  }

  private paperAt(pose: Pose): { x: number; y: number; z: number } {
    return {
      x: pose.x - Math.sin(pose.heading) * PAPER_AHEAD_M,
      y: pose.y + PAPER_UP_M,
      z: pose.z - Math.cos(pose.heading) * PAPER_AHEAD_M,
    };
  }

  /** What the last frame drew. */
  stats(): AirPaysCounts {
    return { ...this.counts };
  }

  dispose(): void {
    this.mark.geometry.dispose();
    this.markMat.dispose();
    this.paper.geometry.dispose();
    (this.paper.material as MeshBasicMaterial).dispose();
  }
}

interface Pose {
  x: number;
  y: number;
  z: number;
  heading: number;
}

function lerped(a: EntitySnapshot, b: EntitySnapshot, alpha: number): Pose {
  const t = Math.min(1, Math.max(0, alpha));
  let dh = b.heading - a.heading;
  while (dh > Math.PI) dh -= 2 * Math.PI;
  while (dh < -Math.PI) dh += 2 * Math.PI;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    heading: a.heading + dh * t,
  };
}
