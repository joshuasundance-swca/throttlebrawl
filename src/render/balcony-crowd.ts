// A party street's crowd (playtest 4, P4-16, "Duval St should be a party street"; the run A check, item 7:
// "at riding speed each frame shows 0 to 2 people, so it is not a crowd yet"). The street's real people
// are the sim's pedestrians: nine to a block side, on the sidewalk, which a rider passes at 40 m/s in a
// second or two. What a rider sees all the way down Duval is the balconies, and on a real party street
// they are full: so every balcony shop of a party block gets a few revellers leaning on its rail, cups
// held high. They stand where no rider can reach (a storey up, two metres in from the facade), so they
// are scenery, never a hitbox, and need nothing of the sim. Code-made upper bodies (a rail hides the
// rest), one mesh and one draw call whatever the length of the street, drawn as party-lights.ts draws
// its bulbs: the whole street in one static buffer and an index of the ones near the camera, refilled as
// it moves. Presentation only.
//
// Run B's check (punch item 4: "the sidewalks look empty in the frames, although the zones sample many party
// kinds"): the same mesh also stands a few people on the pavement of every party block (`sidewalkWalkers`),
// at the back of it under the balconies, a few metres apart. They are scenery too: none stands where a rider
// is held, so a rider hugging the wall passes within a hand of one at most, and the sim's own pedestrians
// stay the ones a rider can hit.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  type Vector3,
} from 'three';
import type { RoadNetwork } from '../sim/api';
import type { LookStyle } from './look';
import { LAND_TOP_M, scatterHash } from './scenery';

/** A text surface as the crowd needs it: where the board stands and which way it faces (text-surfaces.ts). */
export interface CrowdSurface {
  name: string;
  centre: Vector3;
  normal: Vector3;
}

/** The Duval kit's balcony shops: three facades, each with a few shop boards (tools/blender/props/duval_kit.py). */
export const BALCONY_BOARD = /^duval_balcony_[abc]_shop_name_\d+$/;

/** Where a party street's revellers stand, and how many. [default] */
export const CROWD = {
  /** Revellers on the balcony over each shop board. */
  perBoard: 3,
  /** The balcony's floor is this far over the shop board's middle, and its rail stands 1.9 m out, m. */
  floorOverBoardM: 0.97,
  /** They stand this far out from the facade (the rail is at 1.9 m, the wall at 0), and may drift this far, m. */
  outM: 1.0,
  driftM: 0.25,
  /** Their spacing along the balcony, m. */
  spacingM: 1.05,
  /** The most a board's revellers may stand to one side of it, m (a shop is under 5 m wide). */
  halfRangeM: 1.6,
  /** The crowd within this far of the camera is drawn; the index refills every REFILL_M. */
  drawM: 130,
  refillM: 10,
} as const;

/** The people on a party block's pavement (run B's check, item 4). [default] */
export const WALKERS = {
  /** A group of this many stands every `everyM` along each side of a party block, spread over `groupM`. */
  perGroup: 2,
  everyM: 7,
  groupM: 2.4,
  /**
   * They stand this far in from the pavement's back edge, m (the facade's line): the range of the centre of a
   * figure. A rider's wheels are held at the edge, so the nearest a rider comes is a hand's width.
   */
  inM: [0.55, 1.15],
  /** The walkers within this far of the camera are drawn, m (a figure is 2 m tall: 100 m is a speck). */
  drawM: 100,
} as const;

/** Shirt, hat and cup colours: the party street's palette (the revellers of traffic-figures.ts). */
const SHIRTS = ['#ff4fa3', '#2de2ff', '#ffd23f', '#b6ff3c', '#ff9f1c', '#c9a0ff', '#ffffff'] as const;
const SKINS = ['#e8b894', '#c68c64', '#8d5a3b', '#f1cdae', '#6e4429'] as const;
const CUPS = ['#2de2ff', '#ffd23f', '#ff4fa3', '#b6ff3c'] as const;
const TROUSERS = ['#2b2f3a', '#3b4a63', '#6b5a4a', '#e8e0cf', '#4a3f35'] as const;

/** One reveller: where the feet stand (on the balcony's floor), and the way they face (toward the street). */
export interface Reveller {
  x: number;
  y: number;
  z: number;
  /** The facade's outward normal, flat. */
  nx: number;
  nz: number;
  /** Which board it stands over (a walker's group). */
  board: number;
  /** Stands on the pavement, whole, instead of leaning on a balcony rail. */
  walker?: boolean;
}

/** The revellers of every balcony shop board among `surfaces`, in a stable order. */
export function balconyRevellers(
  surfaces: readonly CrowdSurface[],
  seed: number,
  accept: (x: number, z: number) => boolean = () => true,
): Reveller[] {
  const out: Reveller[] = [];
  surfaces.forEach((s, i) => {
    if (!BALCONY_BOARD.test(s.name) || !accept(s.centre.x, s.centre.z)) return;
    const flat = Math.hypot(s.normal.x, s.normal.z);
    if (flat < 0.5) return;
    const nx = s.normal.x / flat;
    const nz = s.normal.z / flat;
    // Along the facade: the board's own right-hand side.
    const tx = -nz;
    const tz = nx;
    const n = CROWD.perBoard;
    for (let k = 0; k < n; k++) {
      const jx = scatterHash(seed, 6101, s.centre.x, i * 8 + k) - 0.5;
      const jo = scatterHash(seed, 6103, s.centre.z, i * 8 + k) - 0.5;
      const along = Math.max(
        -CROWD.halfRangeM,
        Math.min(CROWD.halfRangeM, (k - (n - 1) / 2) * CROWD.spacingM + jx * 0.4),
      );
      const out_ = CROWD.outM + jo * 2 * CROWD.driftM;
      out.push({
        x: s.centre.x + tx * along + nx * out_,
        y: s.centre.y + CROWD.floorOverBoardM,
        z: s.centre.z + tz * along + nz * out_,
        nx,
        nz,
        board: i,
      });
    }
  });
  return out;
}

/** One span of the buffer: a board's revellers, its middle, and how many revellers. */
interface Span {
  v0: number;
  n: number;
  x: number;
  z: number;
  figures: number;
  /** Drawn within this far of the camera, m. */
  drawM: number;
}

export interface BalconyCrowdCounts {
  figures: number;
  shownFigures: number;
  triangles: number;
  drawCalls: number;
}

/** One stretch of a party block's side: the road's edge, from s0 to s1, on one side. */
export interface WalkerRun {
  edge: number;
  s0: number;
  s1: number;
  side: -1 | 1;
}

/**
 * The people standing on the pavement of every party run: a group of `WALKERS.perGroup` every `WALKERS.everyM`,
 * at the back of the pavement (the facade's line), facing the road. Their groups' ids start past every board's.
 */
export function sidewalkWalkers(road: RoadNetwork, runs: readonly WalkerRun[], seed: number): Reveller[] {
  const out: Reveller[] = [];
  let group = 1_000_000;
  for (const run of runs) {
    const e = road.edges[run.edge];
    if (!e) continue;
    const key = run.side < 0 ? 'left' : 'right';
    for (let s = run.s0 + WALKERS.everyM / 2; s < run.s1 - WALKERS.everyM / 2; s += WALKERS.everyM) {
      group++;
      for (let k = 0; k < WALKERS.perGroup; k++) {
        const along =
          s +
          (k - (WALKERS.perGroup - 1) / 2) * WALKERS.groupM +
          (scatterHash(seed, 6131, run.edge * 7919 + s, k) - 0.5) * 1.2;
        const back = Math.abs(road.vergeAt(run.edge, along, key).dOuter);
        const inM =
          WALKERS.inM[0] +
          scatterHash(seed, 6133, run.edge * 7919 + s, k) * (WALKERS.inM[1] - WALKERS.inM[0]);
        const d = run.side * (back - inM);
        const at = road.toWorld(run.edge, along, d, LAND_TOP_M);
        const centre = road.toWorld(run.edge, along, 0, 0);
        const flat = Math.hypot(centre.x - at.x, centre.z - at.z) || 1;
        out.push({
          x: at.x,
          y: at.y,
          z: at.z,
          nx: (centre.x - at.x) / flat,
          nz: (centre.z - at.z) / flat,
          board: group,
          walker: true,
        });
      }
    }
  }
  return out;
}

export interface BalconyCrowdInput {
  surfaces: readonly CrowdSurface[];
  seed: number;
  /** Whether a board at this world position is on a party block (the caller's test). */
  accept?: (x: number, z: number) => boolean;
  /** The party runs to stand people on the pavement of (`sidewalkWalkers`), with the road they are on. */
  walkers?: { road: RoadNetwork; runs: readonly WalkerRun[] };
}

export class BalconyCrowd {
  readonly group = new Group();
  private readonly list: Reveller[];
  private readonly walkerList: Reveller[];
  private readonly rails: Reveller[];
  private readonly spans: Span[] = [];
  private readonly live: Uint32Array;
  private readonly geometry: BufferGeometry | null = null;
  private readonly mesh: Mesh | null = null;
  private filledX = Number.NaN;
  private filledZ = Number.NaN;
  private shownFigures = 0;
  private shownVerts = 0;

  constructor(look: LookStyle, input: BalconyCrowdInput) {
    this.group.name = 'balcony-crowd';
    const rail = balconyRevellers(input.surfaces, input.seed, input.accept);
    this.walkerList = input.walkers
      ? sidewalkWalkers(input.walkers.road, input.walkers.runs, input.seed)
      : [];
    this.list = [...rail, ...this.walkerList];
    this.rails = rail;
    const pos: number[] = [];
    const nrm: number[] = [];
    const col: number[] = [];
    let start = 0;
    while (start < this.list.length) {
      let end = start;
      while (end < this.list.length && this.list[end]?.board === this.list[start]?.board) end++;
      const v0 = pos.length / 3;
      let sx = 0;
      let sz = 0;
      for (let i = start; i < end; i++) {
        const r = this.list[i] as Reveller;
        this.build(r, input.seed, i, pos, nrm, col);
        sx += r.x;
        sz += r.z;
      }
      this.spans.push({
        v0,
        n: pos.length / 3 - v0,
        x: sx / (end - start),
        z: sz / (end - start),
        figures: end - start,
        drawM: (this.list[start] as Reveller).walker ? WALKERS.drawM : CROWD.drawM,
      });
      start = end;
    }
    this.live = new Uint32Array(pos.length / 3);
    if (this.spans.length === 0) return;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setIndex(new BufferAttribute(this.live, 1));
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new Mesh(g, look.material('ped', { vertexColors: true }));
    this.mesh.name = 'balcony-crowd';
    // A street long: never culled whole; the index holds the near ones.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.group.add(this.mesh);
  }

  /** One reveller's upper body as boxes in the facade's frame (t along it, y up, n out toward the street). */
  private build(r: Reveller, seed: number, i: number, pos: number[], nrm: number[], col: number[]): void {
    const tx = -r.nz;
    const tz = r.nx;
    const pick = <T>(list: readonly T[], salt: number): T =>
      list[Math.floor(scatterHash(seed, salt, r.x + r.z, i) * list.length)] as T;
    const shirt = new Color(pick(SHIRTS, 6111));
    const skin = new Color(pick(SKINS, 6113));
    const cup = new Color(pick(CUPS, 6117));
    const hat = new Color(pick(SHIRTS, 6119));
    const leanM = scatterHash(seed, 6121, r.x, i) * 0.12;
    // A box about (a, b, c) = (across the figure, up, toward the street), half sizes, a colour.
    const box = (a: number, b: number, c: number, ha: number, hb: number, hc: number, colour: Color) => {
      const cx = r.x + tx * a + r.nx * (c + leanM);
      const cy = r.y + b;
      const cz = r.z + tz * a + r.nz * (c + leanM);
      const axes: [number, number, number][] = [
        [tx * ha, 0, tz * ha],
        [0, hb, 0],
        [r.nx * hc, 0, r.nz * hc],
      ];
      // Five faces (the bottom is never seen): 2 triangles each, outward, flat-shaded.
      for (const k of [0, 1, 2] as const) {
        for (const sign of [1, -1]) {
          if (k === 1 && sign < 0) continue;
          const u = axes[(k + 1) % 3] as [number, number, number];
          const v = axes[(k + 2) % 3] as [number, number, number];
          const w = axes[k] as [number, number, number];
          const o: [number, number, number] = [cx + w[0] * sign, cy + w[1] * sign, cz + w[2] * sign];
          const corner = (su: number, sv: number): [number, number, number] => [
            o[0] + u[0] * su + v[0] * sv,
            o[1] + u[1] * su + v[1] * sv,
            o[2] + u[2] * su + v[2] * sv,
          ];
          const quad = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
          const n = [w[0] * sign, w[1] * sign, w[2] * sign];
          const len = Math.hypot(n[0] as number, n[1] as number, n[2] as number) || 1;
          // Wind so the face points along n: swap two corners when the cross product disagrees.
          const e1 = [quad[1]![0] - quad[0]![0], quad[1]![1] - quad[0]![1], quad[1]![2] - quad[0]![2]];
          const e2 = [quad[2]![0] - quad[0]![0], quad[2]![1] - quad[0]![1], quad[2]![2] - quad[0]![2]];
          const cr = [
            e1[1]! * e2[2]! - e1[2]! * e2[1]!,
            e1[2]! * e2[0]! - e1[0]! * e2[2]!,
            e1[0]! * e2[1]! - e1[1]! * e2[0]!,
          ];
          const flip = cr[0]! * n[0]! + cr[1]! * n[1]! + cr[2]! * n[2]! < 0;
          const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
          for (const idx of order) {
            const p = quad[idx] as [number, number, number];
            pos.push(p[0], p[1], p[2]);
            nrm.push((n[0] as number) / len, (n[1] as number) / len, (n[2] as number) / len);
            col.push(colour.r, colour.g, colour.b);
          }
        }
      }
    };
    if (r.walker) {
      // A person on the pavement, whole: legs in dark trousers, a torso in a party shirt, a head, a hat, an arm
      // held high with a cup (six boxes, 60 triangles).
      const trousers = new Color(pick(TROUSERS, 6123));
      box(0, 0.42, 0, 0.16, 0.42, 0.1, trousers);
      box(0, 1.15, 0, 0.21, 0.31, 0.12, shirt);
      box(0, 1.62, 0, 0.1, 0.12, 0.1, skin);
      box(0, 1.78, 0, 0.12, 0.04, 0.12, hat);
      box(0.3, 1.5, 0, 0.05, 0.3, 0.05, skin);
      box(0.3, 1.88, 0, 0.075, 0.09, 0.075, cup);
      return;
    }
    // From the rail up: a torso in a party shirt, a head, a hat, an arm held high with a cup.
    box(0, 1.28, 0, 0.23, 0.3, 0.14, shirt);
    box(0, 1.72, 0, 0.11, 0.13, 0.11, skin);
    box(0, 1.9, 0, 0.13, 0.05, 0.13, hat);
    box(0.3, 1.58, 0, 0.055, 0.3, 0.055, skin);
    box(0.3, 1.98, 0, 0.08, 0.1, 0.08, cup);
  }

  /** Per frame: refills the index with the revellers near the camera. */
  update(cameraX: number, cameraZ: number): void {
    if (!this.mesh || !this.geometry) return;
    if (Math.hypot(cameraX - this.filledX, cameraZ - this.filledZ) < CROWD.refillM) return;
    this.filledX = cameraX;
    this.filledZ = cameraZ;
    let w = 0;
    let figures = 0;
    for (const sp of this.spans) {
      if (Math.hypot(sp.x - cameraX, sp.z - cameraZ) > sp.drawM) continue;
      for (let k = 0; k < sp.n; k++) this.live[w++] = sp.v0 + k;
      figures += sp.figures;
    }
    this.shownFigures = figures;
    this.shownVerts = w;
    const index = this.geometry.getIndex();
    if (index) index.needsUpdate = true;
    this.geometry.setDrawRange(0, w);
    this.mesh.visible = w > 0;
  }

  /** Every reveller stood on a balcony (tests). */
  revellers(): readonly Reveller[] {
    return this.rails;
  }

  /** Every person stood on a pavement (tests). */
  walkers(): readonly Reveller[] {
    return this.walkerList;
  }

  counts(): BalconyCrowdCounts {
    return {
      figures: this.list.length,
      shownFigures: this.shownFigures,
      triangles: this.shownVerts / 3,
      drawCalls: this.mesh?.visible ? 1 : 0,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geometry?.dispose();
  }
}
