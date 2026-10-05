// Hand-built baked parts for rig tests that need no downloaded models (playtest 3, T2.4): a rider
// about 1.8 m tall and a sport bike with a 1.4 m wheelbase, with every bone, marker and anchor the
// rig contract names (bake.ts). Not a model, a measuring stick: the numbers are round on purpose.
import { Vector3 } from 'three';
import { RIDER_BONES, type BakedBone, type BakedPart } from './bake';

export const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** A rider about 1.8 m tall, standing, facing -z: every bone and marker the rig contract names. */
export function fakeRider(): BakedPart {
  const rest: Record<string, Vector3> = {
    hips: v(0, 0.95, 0),
    chest: v(0, 1.2, 0),
    head: v(0, 1.5, 0),
    upper_arm_l: v(-0.2, 1.4, 0),
    forearm_l: v(-0.2, 1.12, 0),
    upper_arm_r: v(0.2, 1.4, 0),
    forearm_r: v(0.2, 1.12, 0),
    thigh_l: v(-0.1, 0.92, 0),
    shin_l: v(-0.1, 0.5, 0),
    thigh_r: v(0.1, 0.92, 0),
    shin_r: v(0.1, 0.5, 0),
    coat_l: v(-0.1, 0.9, 0.05),
    coat_r: v(0.1, 0.9, 0.05),
    tie: v(0, 1.3, -0.1),
    hair: v(0, 1.6, 0),
    prop: v(0, 1.6, 0),
  };
  const bones: BakedBone[] = RIDER_BONES.map((name) => ({
    name,
    rest: (rest[name] as Vector3).clone(),
    parent: -1,
  }));
  // One triangle per bone, so every bone has something to move.
  const positions = new Float32Array(RIDER_BONES.length * 9);
  const boneOf = new Uint8Array(RIDER_BONES.length * 3);
  RIDER_BONES.forEach((name, i) => {
    const r = rest[name] as Vector3;
    positions.set([r.x, r.y, r.z, r.x + 0.05, r.y, r.z, r.x, r.y + 0.05, r.z], i * 9);
    boneOf.fill(i, i * 3, i * 3 + 3);
  });
  return {
    kind: 'rider',
    bones,
    positions,
    normals: new Float32Array(positions.length).fill(0.577),
    colors: new Float32Array(positions.length).fill(0.5),
    boneOf,
    coreCount: positions.length / 3,
    points: {
      grip_l: v(-0.2, 0.86, 0),
      grip_r: v(0.2, 0.86, 0),
      ankle_l: v(-0.1, 0.08, 0),
      ankle_r: v(0.1, 0.08, 0),
    },
    pointBone: {},
    roles: [],
    extras: { prop_mount: 'head', seat_m: 0.85 },
    triangles: RIDER_BONES.length,
  };
}

/** A sport bike: 1.4 m wheelbase, the frame, the fork and two wheels, and the rider's anchors. */
export function fakeBike(): BakedPart {
  const bones: BakedBone[] = [
    { name: 'bike', rest: v(0, 0, 0), parent: -1 },
    { name: 'fork', rest: v(0, 0.85, -0.55), parent: 0 },
    { name: 'wheel_front', rest: v(0, 0.32, -0.7), parent: 0 },
    { name: 'wheel_rear', rest: v(0, 0.32, 0.7), parent: 0 },
  ];
  const positions = new Float32Array(bones.length * 9);
  const boneOf = new Uint8Array(bones.length * 3);
  bones.forEach((b, i) => {
    positions.set(
      [b.rest.x, b.rest.y, b.rest.z, b.rest.x + 0.1, b.rest.y, b.rest.z, b.rest.x, b.rest.y + 0.1, b.rest.z],
      i * 9,
    );
    boneOf.fill(i, i * 3, i * 3 + 3);
  });
  return {
    kind: 'bike',
    bones,
    positions,
    normals: new Float32Array(positions.length).fill(0.577),
    colors: new Float32Array(positions.length).fill(0.5),
    boneOf,
    coreCount: positions.length / 3,
    points: {
      seat_anchor: v(0, 0.8, 0.3),
      bar_l: v(-0.3, 1.1, -0.15),
      bar_r: v(0.3, 1.1, -0.15),
      peg_l: v(-0.22, 0.35, 0.15),
      peg_r: v(0.22, 0.35, 0.15),
    },
    pointBone: {},
    roles: [],
    extras: { wheelbase_m: 1.4, class: 'sport' },
    triangles: bones.length,
  };
}
