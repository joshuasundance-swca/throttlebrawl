// The headland battery's guns (playtest 4, run C's live check: "the headland batteries read as small grey blocks or
// rubble on Conzelman's verge, not gun emplacements"; the fix check: "1 of 6 Conzelman frames shows a gun").
// CX6's `gg_battery` is a concrete block with two open hexagonal gun pits behind its front wall, so from the road it
// is a long grey wall with three dark slits and no gun in it. This lane has no Blender, so the guns are code-made, in
// the model's own metres (x along the road, y up, z toward the road).
//
// Run C's first guns lay a thin barrel over the parapet at 12 degrees, down inside the pit: from a camera 3 to 5 m
// up the front wall (5.6 m at the battery's size) hid the pit and the breech, and the barrel was a dark line against
// a grey wall that showed only up close. These guns stand on a pedestal out of the pit, the barrel is thick and
// lifted 30 degrees so its muzzle rises over the wall into the sky, and each pit has a dark collar around its rim
// that stands over the roofline, so a gun and its pit read as a silhouette from the distance a rider sees them.
// The pits' insides are dark, and the concrete is paler against the verge's grass. The muzzle still ends inside the
// model's front (z 5.5) so the scatter's footprint rule holds.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { pushTube } from './bridge-bays';

export interface GunNumbers {
  /** The pits' middles along the model (CX6: x = -7 and 7), and how far back from the front wall they stand. */
  pitX: readonly number[];
  pitZ: number;
  /** The pit hexagon's circumradius and floor, and the block's top the rim stands on (CX6's numbers). */
  pitRadiusM: number;
  floorY: number;
  rimY: number;
  /** The dark collar around each pit's rim: its tube radius, and how far above the rim it stands (0: none). */
  collarRadiusM: number;
  collarLiftM: number;
  /** The pedestal the gun stands on, from the pit floor to the trunnion: its radius (0: none). */
  pedestalRadiusM: number;
  /** The trunnion's height. */
  pivotY: number;
  /** The barrel's lift above level, degrees, and its length, m: its muzzle ends just short of the front wall. */
  liftDeg: number;
  barrelM: number;
  barrelRadiusM: number;
  /** The breech block behind the pivot, and the barrel's muzzle ring. */
  breechRadiusM: number;
  breechM: number;
  muzzleRadiusM: number;
  muzzleM: number;
  sides: number;
  /** Dark gun steel (linear, as the model's colours are), its lighter muzzle ring, and the collar's dark concrete. */
  colour: readonly number[];
  muzzleColour: readonly number[];
  collarColour: readonly number[];
}

/** The guns' numbers, model metres. [default] */
export const BATTERY_GUNS: GunNumbers = {
  pitX: [-7, 7],
  pitZ: -0.7,
  pitRadiusM: 3.6,
  floorY: 2,
  rimY: 4,
  collarRadiusM: 0.55,
  collarLiftM: 0.35,
  pedestalRadiusM: 0.95,
  pivotY: 5.0,
  liftDeg: 30,
  barrelM: 7.4,
  barrelRadiusM: 0.78,
  breechRadiusM: 1.2,
  breechM: 2.6,
  muzzleRadiusM: 1.0,
  muzzleM: 1.1,
  sides: 8,
  colour: [0.05, 0.055, 0.06],
  muzzleColour: [0.11, 0.115, 0.12],
  collarColour: [0.09, 0.09, 0.085],
};

/** Run C's first guns (thin, 12 degrees, down in the pit, no collar), kept as the control the screen-size test measures against. */
export const BATTERY_GUNS_FIRST: GunNumbers = {
  ...BATTERY_GUNS,
  collarRadiusM: 0,
  collarLiftM: 0,
  pedestalRadiusM: 0,
  pivotY: 3.2,
  liftDeg: 12,
  barrelRadiusM: 0.42,
  breechRadiusM: 0.75,
  breechM: 1.8,
  muzzleRadiusM: 0.55,
  muzzleM: 0.7,
  colour: [0.07, 0.08, 0.09],
  muzzleColour: [0.13, 0.14, 0.15],
};

/** The battery's concrete as the file draws it (linear), and the paler concrete it is drawn in now. */
export const CONCRETE_FILE = [0.36, 0.37, 0.31] as const;
export const CONCRETE_PALE = [0.58, 0.59, 0.52] as const;
/** What the pits' insides are drawn in: nearly black, so a pit reads as a hole. */
export const PIT_DARK = [0.03, 0.032, 0.03] as const;

const close = (a: number, b: number): boolean => Math.abs(a - b) < 0.006;

/**
 * The battery variant with a gun in each pit: a new geometry (the source is left alone), the file's own triangles
 * first and unchanged in order and count, so a role run still names them (their colours change: the concrete is
 * paler and each pit's inside is dark), then the guns, pedestals and collars. The kit's variants are triangle
 * lists with position, normal and colour only.
 */
export function withBatteryGuns(g: BufferGeometry, G: GunNumbers = BATTERY_GUNS): BufferGeometry {
  const add = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  const lift = (G.liftDeg * Math.PI) / 180;
  const along = (len: number): [number, number] => [Math.cos(lift) * len, Math.sin(lift) * len];
  for (const x of G.pitX) {
    const [bz, by] = along(G.breechM);
    const [mz, my] = along(G.barrelM);
    const [rz, ry] = along(G.muzzleM);
    const pivotZ = G.pitZ - 1.1;
    // The pedestal from the pit's floor up to the trunnion, so the gun stands out of the pit.
    if (G.pedestalRadiusM > 0)
      pushTube(add, [x, G.floorY, G.pitZ], [x, G.pivotY, G.pitZ], G.pedestalRadiusM, G.sides, G.colour);
    // The breech block behind the pivot, then the barrel from it, then the muzzle ring on the barrel's end.
    pushTube(add, [x, G.pivotY - by, pivotZ - bz], [x, G.pivotY, pivotZ], G.breechRadiusM, G.sides, G.colour);
    pushTube(add, [x, G.pivotY, pivotZ], [x, G.pivotY + my, pivotZ + mz], G.barrelRadiusM, G.sides, G.colour);
    pushTube(
      add,
      [x, G.pivotY + my - ry, pivotZ + mz - rz],
      [x, G.pivotY + my, pivotZ + mz],
      G.muzzleRadiusM,
      G.sides,
      G.muzzleColour,
    );
    // The dark collar: the pit's hexagon, a tube along each side, standing over the roofline.
    if (G.collarRadiusM > 0) {
      const y = G.rimY + G.collarLiftM;
      const corner = (k: number): [number, number, number] => {
        const a = (k / 6) * Math.PI * 2;
        return [x + Math.cos(a) * G.pitRadiusM, y, G.pitZ + Math.sin(a) * G.pitRadiusM];
      };
      for (let k = 0; k < 6; k++) pushTube(add, corner(k), corner(k + 1), G.collarRadiusM, 6, G.collarColour);
    }
  }
  const out = new BufferGeometry();
  for (const [name, extra] of [
    ['position', add.pos],
    ['normal', add.nrm],
    ['color', add.col],
  ] as const) {
    const src = g.getAttribute(name);
    const merged = new Float32Array(src.count * 3 + extra.length);
    for (let i = 0; i < src.count; i++) {
      merged[i * 3] = src.getX(i);
      merged[i * 3 + 1] = src.getY(i);
      merged[i * 3 + 2] = src.getZ(i);
    }
    merged.set(extra, src.count * 3);
    out.setAttribute(name, new Float32BufferAttribute(merged, 3));
  }
  // The file's own vertices, recoloured: the pale concrete everywhere the file draws its grey, and each pit's inside
  // (inside the hexagon, from its floor up to its rim) dark.
  if (G.collarRadiusM > 0) {
    const pos = g.getAttribute('position');
    const col = out.getAttribute('color');
    for (let i = 0; i < pos.count; i++) {
      const c = [col.getX(i), col.getY(i), col.getZ(i)];
      if (
        !close(c[0]!, CONCRETE_FILE[0]) ||
        !close(c[1]!, CONCRETE_FILE[1]) ||
        !close(c[2]!, CONCRETE_FILE[2])
      )
        continue;
      const inPit = G.pitX.some(
        (px) =>
          Math.hypot(pos.getX(i) - px, pos.getZ(i) - G.pitZ) <= G.pitRadiusM + 0.02 &&
          pos.getY(i) >= G.floorY - 0.02 &&
          pos.getY(i) <= G.rimY + 0.02,
      );
      const to = inPit ? PIT_DARK : CONCRETE_PALE;
      col.setXYZ(i, to[0], to[1], to[2]);
    }
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
