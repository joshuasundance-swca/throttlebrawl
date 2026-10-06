// Chuckanut's shore models, finished in code (playtest 4 run C's live check, punch item 7: "the bay-side drop reads as
// stepped green terraces and the parapet as a dark low rail, and a rock cut ends in a flat vertical edge"). CX6's
// `models/scenery/pnw-shore` (tools/blender/props/pnw_shore.py) is Blender work and this lane has no Blender, so the
// file is left alone and its variants are reshaped when it bakes, as the battery's guns and the repair platform's piles
// are (battery-guns.ts, bridge-bays.ts): a new geometry each, the file's own vertices in the same order, so a role run
// still names the same triangles. Every number is in the model's own metres (x along the road, y up, z toward the road,
// -z toward the water). [default]
import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { RoleRun } from './models';

export const SHORE_FIX = {
  /**
   * The bluff's lean: its outward reach (-z) is scaled by this. CX6's profile leans 0.45 to 0.7 m out for every metre
   * it falls, in 1.3 m ledges with moss on them, which from above reads as stepped green terraces; a quarter of that
   * is a sheer face with its ledges a hand deep.
   */
  bluffLean: 0.25,
  /**
   * The face goes on to here, m under the lip (the road is 41 to 70 m over the bay): the file's toe, a 7 m shelf 40 m
   * down, hung over the water as the last terrace. Below `bluffStretchFrom` the last step is stretched to this depth,
   * so the face runs into the sea and the toe lies under it.
   */
  bluffToeY: -110,
  bluffStretchFrom: -29,
  /** The rock's colour at the lip and at the toe (a wet, dark foot), as a share of the file's. */
  bluffFootShade: 0.62,
  /** The bluff's moss, repainted: a weathered, dark sandstone (linear, as the model's colours are). */
  bluffMoss: [0.27, 0.2, 0.12],
  /** The parapet: this much taller, in a paler stone with a whiter coping (linear). */
  parapetRise: 1.4,
  parapetStone: [0.6, 0.55, 0.43],
  parapetCoping: [0.74, 0.72, 0.63],
  /** A tapered cut end: its height at the low end, as a share of the section's, falling linearly over the section's 6 m. */
  cutEndLow: 0.1,
} as const;

/** The variants appended to the file's eight: the short cut's end that falls toward +x and toward -x, then the tall cut's. */
export const SHORE_END_VARIANTS = { low: [8, 9], tall: [10, 11] } as const;

type Rgb = readonly [number, number, number];

/** A copy of the geometry with its own position, normal and colour arrays, to be reshaped. */
function copyOf(g: BufferGeometry): { pos: Float32Array; nrm: Float32Array; col: Float32Array } {
  return {
    pos: Float32Array.from(g.getAttribute('position').array as ArrayLike<number>),
    nrm: Float32Array.from(g.getAttribute('normal').array as ArrayLike<number>),
    col: Float32Array.from(g.getAttribute('color').array as ArrayLike<number>),
  };
}

/** Sets every triangle's three normals to its face's normal (the kit is faceted). */
function faceNormals(pos: Float32Array, nrm: Float32Array): void {
  for (let i = 0; i + 2 < pos.length / 3; i += 3) {
    const o = i * 3;
    const ux = pos[o + 3]! - pos[o]!;
    const uy = pos[o + 4]! - pos[o + 1]!;
    const uz = pos[o + 5]! - pos[o + 2]!;
    const vx = pos[o + 6]! - pos[o]!;
    const vy = pos[o + 7]! - pos[o + 1]!;
    const vz = pos[o + 8]! - pos[o + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) {
      // A face with no area keeps the normal it had.
      continue;
    }
    nx /= l;
    ny /= l;
    nz /= l;
    for (let k = 0; k < 3; k++) {
      nrm[o + k * 3] = nx;
      nrm[o + k * 3 + 1] = ny;
      nrm[o + k * 3 + 2] = nz;
    }
  }
}

function build(pos: Float32Array, nrm: Float32Array, col: Float32Array): BufferGeometry {
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new Float32BufferAttribute(col, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Paints every vertex of the runs of one role. */
function paintRole(col: Float32Array, runs: readonly RoleRun[], role: string, to: Rgb): void {
  for (const run of runs) {
    if (run.role !== role) continue;
    for (let i = run.start; i < run.start + run.count; i++) {
      col[i * 3] = to[0];
      col[i * 3 + 1] = to[1];
      col[i * 3 + 2] = to[2];
    }
  }
}

/**
 * The bluff as a cliff to the water: no green on its ledges, a face a quarter as deep, running on down into the
 * sea, darker toward its foot.
 */
export function bluffCliff(g: BufferGeometry, runs: readonly RoleRun[]): BufferGeometry {
  const F = SHORE_FIX;
  const { pos, nrm, col } = copyOf(g);
  paintRole(col, runs, 'moss', F.bluffMoss);
  const stretch = (F.bluffToeY - F.bluffStretchFrom) / (-40 - F.bluffStretchFrom);
  for (let i = 0; i < pos.length / 3; i++) {
    pos[i * 3 + 2] = pos[i * 3 + 2]! * F.bluffLean;
    const y = pos[i * 3 + 1]!;
    if (y < F.bluffStretchFrom) pos[i * 3 + 1] = F.bluffStretchFrom + (y - F.bluffStretchFrom) * stretch;
    // The foot is wetter and darker, smoothly with the depth below the lip's first 29 m.
    const t = Math.min(
      1,
      Math.max(0, (F.bluffStretchFrom - pos[i * 3 + 1]!) / (F.bluffStretchFrom - F.bluffToeY)),
    );
    const k = 1 + (F.bluffFootShade - 1) * t;
    for (let c = 0; c < 3; c++) col[i * 3 + c] = col[i * 3 + c]! * k;
  }
  faceNormals(pos, nrm);
  return build(pos, nrm, col);
}

/** The parapet as a wall: taller, in a paler stone, with a whiter coping on top. */
export function parapetWall(g: BufferGeometry, runs: readonly RoleRun[]): BufferGeometry {
  const F = SHORE_FIX;
  const { pos, nrm, col } = copyOf(g);
  paintRole(col, runs, 'sandstone', F.parapetStone);
  paintRole(col, runs, 'concrete', F.parapetCoping);
  for (let i = 0; i < pos.length / 3; i++) pos[i * 3 + 1] = pos[i * 3 + 1]! * F.parapetRise;
  faceNormals(pos, nrm);
  return build(pos, nrm, col);
}

/**
 * A rock cut with one end tapered into the ground: its height falls linearly from the full section to `cutEndLow` of
 * it at the end `toward` (+1: +x, -1: -x), its depth and length unchanged, so it joins a run's last section on the
 * same line. The file's section is the same at both ends, which left each run's two ends flat and vertical.
 */
export function cutEnd(g: BufferGeometry, toward: 1 | -1): BufferGeometry {
  const F = SHORE_FIX;
  const { pos, nrm, col } = copyOf(g);
  for (let i = 0; i < pos.length / 3; i++) {
    // 0 at the section's far end, 1 at the tapered end, over its 6 m (x from -3 to +3).
    const u = Math.min(1, Math.max(0, (toward * pos[i * 3]! + 3) / 6));
    pos[i * 3 + 1] = pos[i * 3 + 1]! * (1 + (F.cutEndLow - 1) * u);
  }
  faceNormals(pos, nrm);
  return build(pos, nrm, col);
}

/**
 * The shore kit's variants as the game draws them: the file's eight, with the bluff and the parapet reshaped and
 * the four tapered cut ends appended (`SHORE_END_VARIANTS`). `runs` are the variants' role runs; the ends take
 * their section's.
 */
export function finishShore(
  variants: BufferGeometry[],
  roles: RoleRun[][],
): { variants: BufferGeometry[]; roles: RoleRun[][] } {
  const out = variants.slice();
  const outRoles = roles.slice();
  out[2] = parapetWall(variants[2]!, roles[2] ?? []);
  out[3] = bluffCliff(variants[3]!, roles[3] ?? []);
  for (const [k, base] of [0, 1].entries()) {
    const [plus, minus] = k === 0 ? SHORE_END_VARIANTS.low : SHORE_END_VARIANTS.tall;
    out[plus] = cutEnd(variants[base]!, 1);
    out[minus] = cutEnd(variants[base]!, -1);
    outRoles[plus] = roles[base] ?? [];
    outRoles[minus] = roles[base] ?? [];
  }
  return { variants: out, roles: outRoles };
}
