import { Mesh, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SignatureSnapshot, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import { RIDER_BONES, type RiderBone } from './bake';
import { RiderRigs } from './index';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

// Snapshot-only geometry: no encounter identity or phase-duration fingerprint.
const sig = (phase: SignatureSnapshot['phase']): SignatureSnapshot => ({
  move: 'ram',
  phase,
  seconds: 0,
  left: 1,
  targetId: -1,
});
const entity = (extra: Partial<EntitySnapshot> = {}): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 20,
  lean: 0,
  contentId: 'base:ordinary-rival',
  name: 'rival',
  faction: 'rider',
  slot: 0,
  throttle: 0,
  rpm: 0,
  gear: 1,
  grounded: true,
  health: 100,
  healthMax: 100,
  attackPhase: 'idle',
  heldWeapon: null,
  targetId: -1,
  lastAttackerId: -1,
  progress: 0,
  distanceToFinish: 0,
  place: 1,
  finished: false,
  ...extra,
});
function world() {
  const rigs = new RiderRigs(createFlatLook(), null, defaultRenderParams());
  rigs.addPart('models/riders/ordinary-rival', fakeRider());
  rigs.addPart('models/bikes/sport', fakeBike());
  rigs.setLooks([riderLookOf({ contentId: 'base:ordinary-rival', role: 'rival', bikeId: 'base:sport' })]);
  const frame = {
    root: new Object3D(),
    parked: new Object3D(),
    tumbleBike: new Object3D(),
    weapon: new Mesh(),
    glint: new Mesh(),
    flashing: false,
    time: 1,
    dt: 1,
  };
  const pose = (e: EntitySnapshot, targetX = 10) => {
    const target = entity({ id: 1, x: targetX });
    const snap = { tick: 60, timeScale: 1, entities: [e, target] } as unknown as SimSnapshot;
    expect(rigs.update(e, e, snap, frame)).toBe(true);
  };
  const rotation = (bone: RiderBone) => {
    const q = rigs.boneRotation(0, bone);
    if (!q) throw new Error(bone);
    return q;
  };
  const position = (bone: RiderBone) => {
    const p = rigs.bonePosition(0, bone);
    if (!p) throw new Error(bone);
    return p;
  };
  const tilt = (bone: RiderBone) => {
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation(bone));
    return Math.atan2(-up.z, up.y);
  };
  return { rigs, pose, rotation, position, tilt };
}
function measured(extra: Partial<EntitySnapshot> = {}, targetX = 10) {
  const w = world();
  w.pose(entity(extra), targetX);
  return w;
}
function same(a: ReturnType<typeof world>, b: ReturnType<typeof world>) {
  for (const bone of RIDER_BONES) {
    expect(a.position(bone).distanceTo(b.position(bone)), bone).toBeLessThan(1e-7);
    expect(a.rotation(bone).angleTo(b.rotation(bone)), bone).toBeLessThan(1e-7);
  }
}
describe('Mother Rust geometry on the production Rig path (fixture parts)', () => {
  it('distinguishes preparation, commitment and recovery then returns to neutral', () => {
    const neutral = measured(),
      tell = measured({ signature: sig('tell') }),
      act = measured({ signature: sig('act') }),
      open = measured({ signature: sig('open') });
    expect(tell.rotation('head').angleTo(neutral.rotation('head'))).toBeGreaterThan(0.2);
    expect(act.tilt('chest')).toBeGreaterThan(tell.tilt('chest') + 0.1);
    expect(open.tilt('chest')).toBeLessThan(tell.tilt('chest') - 0.1);
    expect(open.rotation('head').angleTo(act.rotation('head'))).toBeGreaterThan(0.2);
    const w = world();
    for (const phase of ['tell', 'act', 'open'] as const) w.pose(entity({ signature: sig(phase) }));
    w.pose(entity());
    same(w, neutral);
  });
  it.each(['act', 'open'] as const)(
    '%s never infers committed direction from current target side',
    (phase) => {
      const baseline = measured({ signature: sig(phase) });
      for (const targetX of [-10, 10])
        same(measured({ signature: { ...sig(phase), targetId: 1 }, targetId: 1 }, targetX), baseline);
    },
  );
  it.each(['windup', 'active', 'recovery'] as const)(
    'keeps whole-rig supported combat during %s and resumes each ram phase',
    (attackPhase) => {
      for (const phase of ['tell', 'act', 'open'] as const)
        for (const kick of [false, true])
          for (const targetX of [-10, 10]) {
            const ordinary = world(),
              overlap = world();
            for (const w of [ordinary, overlap]) {
              w.pose(entity());
              w.rigs.pushEvents([
                { tick: 60, type: 'attackStart', actor: 0, data: { kind: kick ? 'kick' : 'punch' } },
              ]);
            }
            ordinary.pose(entity({ targetId: 1, attackPhase }), targetX);
            overlap.pose(
              entity({ targetId: 1, attackPhase, signature: { ...sig(phase), targetId: 1 } }),
              targetX,
            );
            same(overlap, ordinary);
            expect(
              ordinary
                .rotation(
                  kick ? (targetX > 0 ? 'thigh_r' : 'thigh_l') : targetX > 0 ? 'upper_arm_r' : 'upper_arm_l',
                )
                .angleTo(
                  measured().rotation(
                    kick
                      ? targetX > 0
                        ? 'thigh_r'
                        : 'thigh_l'
                      : targetX > 0
                        ? 'upper_arm_r'
                        : 'upper_arm_l',
                  ),
                ),
            ).toBeGreaterThan(0.1);
            overlap.pose(entity({ signature: sig(phase) }));
            same(overlap, measured({ signature: sig(phase) }));
          }
    },
  );
  it('retains non-ram counter geometry', () => {
    const counter = measured({ signature: { ...sig('tell'), move: 'counter', targetId: 1 } }, -10),
      neutral = measured();
    expect(counter.rotation('chest').angleTo(neutral.rotation('chest'))).toBeLessThan(1e-7);
    expect(counter.rotation('head').angleTo(neutral.rotation('head'))).toBeCloseTo(1.3, 7);
  });
});
