import { Mesh, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SignatureSnapshot, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import { RIDER_BONES, type RiderBone } from './bake';
import { RiderRigs } from './index';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

// juniper-phase-clarity Automated acceptance: real Rig geometry on measuring-stick parts.
// This does not establish shipped-model pixels or phone recognition.
const sig = (phase: SignatureSnapshot['phase'], seconds = 0): SignatureSnapshot => ({
  move: 'cut-in',
  phase,
  seconds,
  left: 1,
  targetId: 1,
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
  const pose = (extra: Partial<EntitySnapshot> = {}, targetX = 10) => {
    const e = entity(extra),
      target = entity({ id: 1, x: targetX });
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
  const tilt = () => {
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation('chest'));
    return Math.atan2(-up.z, up.y);
  };
  return { rigs, pose, rotation, position, tilt };
}
function measured(extra: Partial<EntitySnapshot> = {}, targetX = 10) {
  const w = world();
  w.pose(extra, targetX);
  return w;
}
function same(a: ReturnType<typeof world>, b: ReturnType<typeof world>) {
  for (const bone of RIDER_BONES) {
    expect(a.position(bone).distanceTo(b.position(bone)), bone).toBeLessThan(1e-7);
    expect(a.rotation(bone).angleTo(b.rotation(bone)), bone).toBeLessThan(1e-7);
  }
}
describe('Juniper: shoulder check, cut and pull-away', () => {
  it.each([0, 0.2, 0.6])('distinguishes cut and opening at %s phase seconds', (seconds) => {
    const tell = measured({ signature: sig('tell', seconds) }),
      act = measured({ signature: sig('act', seconds) }),
      open = measured({ signature: sig('open', seconds) });
    expect(act.tilt()).toBeGreaterThan(tell.tilt() + 0.2);
    expect(open.rotation('chest').angleTo(act.rotation('chest'))).toBeGreaterThan(0.25);
    expect(open.position('head').z).toBeGreaterThan(act.position('head').z + 0.05);
    same(act, measured({ signature: sig('act', seconds) }));
  });
  it.each([-10, 10])('checks toward the actual target at x=%s during tell', (targetX) => {
    const tell = measured({ signature: sig('tell') }, targetX);
    const gaze = new Vector3(0, 0, -1).applyQuaternion(tell.rotation('head'));
    expect(gaze.x * Math.sign(targetX)).toBeGreaterThan(0.4);
  });
  it.each(['act', 'open'] as const)('%s does not invent a committed side', (phase) => {
    const baseline = measured({ signature: sig(phase) });
    for (const targetX of [-10, 10]) same(measured({ signature: sig(phase) }, targetX), baseline);
  });
  it.each(['tell', 'act', 'open'] as const)('keeps riding contacts during %s without combat', (phase) => {
    const w = measured({ signature: sig(phase) });
    for (const side of ['l', 'r'] as const) {
      const hand = w.rigs.limbEnd(0, `grip_${side}`)!;
      const bar = w.rigs.bikePoint(0, `bar_${side}`)!;
      const ankle = w.rigs.limbEnd(0, `ankle_${side}`)!;
      const boot = w.rigs.bikePoint(0, `peg_${side}`)!.add(new Vector3(0, 0.075, 0.035));
      expect(hand.distanceTo(bar)).toBeLessThan(0.06);
      expect(ankle.distanceTo(boot)).toBeLessThan(0.06);
    }
  });
  it('returns every bone to ordinary riding when the move ends', () => {
    const w = world();
    for (const phase of ['tell', 'act', 'open'] as const) w.pose({ signature: sig(phase) });
    w.pose();
    same(w, measured());
  });
  it.each(['windup', 'active', 'recovery'] as const)(
    'preserves whole-rig combat during %s',
    (attackPhase) => {
      for (const phase of ['tell', 'act', 'open'] as const)
        for (const kick of [false, true])
          for (const targetX of [-10, 10]) {
            const ordinary = world(),
              overlap = world();
            for (const w of [ordinary, overlap]) {
              w.pose();
              w.rigs.pushEvents([
                { tick: 60, type: 'attackStart', actor: 0, data: { kind: kick ? 'kick' : 'punch' } },
              ]);
            }
            ordinary.pose({ targetId: 1, attackPhase }, targetX);
            overlap.pose({ targetId: 1, attackPhase, signature: sig(phase) }, targetX);
            same(overlap, ordinary);
            const bone = kick
              ? targetX > 0
                ? 'thigh_r'
                : 'thigh_l'
              : targetX > 0
                ? 'upper_arm_r'
                : 'upper_arm_l';
            expect(ordinary.rotation(bone).angleTo(measured().rotation(bone))).toBeGreaterThan(0.1);
            overlap.pose({ signature: sig(phase) }, targetX);
            same(overlap, measured({ signature: sig(phase) }, targetX));
          }
    },
  );
  it('retains the existing non-cut-in counter body and head', () => {
    const neutral = measured(),
      counter = measured({ signature: { ...sig('tell'), move: 'counter' } });
    expect(counter.rotation('chest').angleTo(neutral.rotation('chest'))).toBeLessThan(1e-7);
    expect(counter.rotation('head').angleTo(neutral.rotation('head'))).toBeCloseTo(1.3, 7);
  });
});
