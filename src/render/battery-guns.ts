// The headland battery's guns (playtest 4, run C's live check: "the headland batteries read as small grey blocks or
// rubble on Conzelman's verge, not gun emplacements"). CX6's `gg_battery` is a concrete block with two open
// hexagonal gun pits behind its front wall, so from the road it is a long grey wall with three dark slits and
// no gun in it. This lane has no Blender, so the guns are code-made, in the model's own metres (x along the road,
// y up, z toward the road): a breech block and a barrel in each pit, laid on the front parapet and lifted a few
// degrees, ending inside the model's front (z 5.5) so the scatter's footprint rule still holds.
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { pushTube } from './bridge-bays';

/** The guns' numbers, model metres. [default] */
export const BATTERY_GUNS = {
  /** The pits' middles along the model (CX6: x = -7 and 7), and how far back from the front wall they stand. */
  pitX: [-7, 7],
  pitZ: -0.7,
  /** The trunnion's height: over the pit's 2 m floor and under its 4 m rim. */
  pivotY: 3.2,
  /** The barrel's lift above level, degrees, and its length, m: its muzzle ends just short of the front wall. */
  liftDeg: 12,
  barrelM: 7.4,
  barrelRadiusM: 0.42,
  /** The breech block behind the pivot, and the barrel's muzzle ring. */
  breechRadiusM: 0.75,
  breechM: 1.8,
  muzzleRadiusM: 0.55,
  muzzleM: 0.7,
  sides: 8,
  /** Dark gun steel (linear, as the model's colours are), and its lighter muzzle ring. */
  colour: [0.07, 0.08, 0.09],
  muzzleColour: [0.13, 0.14, 0.15],
} as const;

/**
 * The battery variant with a gun in each pit: a new geometry (the source is left alone), the file's own triangles
 * first and unchanged, so a role run still names them. The kit's variants are triangle lists with position,
 * normal and colour only.
 */
export function withBatteryGuns(g: BufferGeometry): BufferGeometry {
  const G = BATTERY_GUNS;
  const add = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  const lift = (G.liftDeg * Math.PI) / 180;
  const along = (len: number): [number, number] => [Math.cos(lift) * len, Math.sin(lift) * len];
  for (const x of G.pitX) {
    const [bz, by] = along(G.breechM);
    const [mz, my] = along(G.barrelM);
    const [rz, ry] = along(G.muzzleM);
    const pivotZ = G.pitZ - 1.1;
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
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}
