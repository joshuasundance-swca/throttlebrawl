import { Mesh, Object3D, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SignatureSnapshot, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { defaultRenderParams } from '../tuning';
import { RIDER_BONES, type RiderBone } from './bake';
import { RiderRigs } from './index';
import { bikeFrame, riderFrame, seating } from './pose';
import { fakeBike, fakeRider } from './rig-fixtures.test-util';

// Old Growth encounter, Automated acceptance 4 / Proposed behavior 3: all Timber snapshots
// get distinct body language. This fixture measures geometry, not rendered/phone readability.
const ID = 'base:ordinary-rival';
const sig = (
  phase: SignatureSnapshot['phase'],
  seconds = 0,
  move: SignatureSnapshot['move'] = 'timber',
): SignatureSnapshot => ({ move, phase, seconds, left: 1, targetId: -1 });

function entity(signature: SignatureSnapshot | null): EntitySnapshot {
  return {
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
    contentId: ID,
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
    signature,
  };
}

function world() {
  const rigs = new RiderRigs(createFlatLook(), null, defaultRenderParams());
  rigs.addPart('models/riders/ordinary-rival', fakeRider());
  rigs.addPart('models/bikes/sport', fakeBike());
  rigs.setLooks([riderLookOf({ contentId: ID, role: 'rival', bikeId: 'base:sport' })]);
  const frame = {
    root: new Object3D(),
    parked: new Object3D(),
    tumbleBike: new Object3D(),
    weapon: new Mesh(),
    glint: new Mesh(),
    flashing: false,
    time: 1,
    // Exercise the pose directly, with a single long easing step; no frame/wall-clock wait.
    dt: 1,
  };
  const pose = (signature: SignatureSnapshot | null) => {
    const e = entity(signature);
    const curr = { tick: 60, timeScale: 1, entities: [e] } as unknown as SimSnapshot;
    expect(rigs.update(e, e, curr, frame)).toBe(true);
  };
  const rotation = (bone: RiderBone) => {
    const q = rigs.boneRotation(0, bone);
    if (!q) throw new Error(`missing ${bone} rotation`);
    return q;
  };
  const position = (bone: RiderBone) => {
    const p = rigs.bonePosition(0, bone);
    if (!p) throw new Error(`missing ${bone} position`);
    return p;
  };
  /** Forward tilt in radians: positive is toward the bike's nose (-z). */
  const forwardTilt = (bone: RiderBone) => {
    const up = new Vector3(0, 1, 0).applyQuaternion(rotation(bone));
    return Math.atan2(-up.z, up.y);
  };
  return { rigs, pose, rotation, position, forwardTilt };
}

function measured(signature: SignatureSnapshot | null) {
  const w = world();
  w.pose(signature);
  return w;
}

describe('Timber: brace, committed charge and winded opening', () => {
  it.each([0, 0.2, 0.8])('distinguishes every phase at %s seconds, even on an ordinary rival', (seconds) => {
    const neutral = measured(null);
    const tell = measured(sig('tell', seconds));
    const act = measured(sig('act', seconds));
    const open = measured(sig('open', seconds));

    expect(
      open.rotation('chest').angleTo(act.rotation('chest')),
      'recovery differs from charge',
    ).toBeGreaterThan(0.35);
    expect(tell.forwardTilt('chest'), 'the tell braces forward from neutral').toBeGreaterThan(
      neutral.forwardTilt('chest') + 0.08,
    );
    expect(act.forwardTilt('chest'), 'the committed charge crouches beyond the brace').toBeGreaterThan(
      tell.forwardTilt('chest') + 0.25,
    );
    expect(open.forwardTilt('chest'), 'recovery sits out of the charge crouch').toBeLessThan(
      tell.forwardTilt('chest') - 0.15,
    );
    expect(open.forwardTilt('head'), 'recovery bows the head well below the charge gaze').toBeGreaterThan(
      act.forwardTilt('head') + 0.35,
    );
    expect(open.forwardTilt('head'), 'the tell has its head up, recovery does not').toBeGreaterThan(
      tell.forwardTilt('head') + 0.45,
    );
    expect(act.position('head').z, 'charge head further toward the nose than the brace').toBeLessThan(
      tell.position('head').z - 0.05,
    );
    expect(open.position('head').z, 'recovery lifts out of the forward charge silhouette').toBeGreaterThan(
      act.position('head').z + 0.1,
    );
    expect(open.position('hips').y, 'the exhausted rider sinks slightly onto the seat').toBeLessThan(
      neutral.position('hips').y - 0.015,
    );
  });

  it.each(['tell', 'act', 'open'] as const)(
    'keeps hands on the bars and feet on the pegs during %s',
    (phase) => {
      const w = measured(sig(phase));
      for (const side of ['l', 'r'] as const) {
        const hand = w.rigs.limbEnd(0, `grip_${side}`) as Vector3;
        const bar = w.rigs.bikePoint(0, `bar_${side}`) as Vector3;
        const ankle = w.rigs.limbEnd(0, `ankle_${side}`) as Vector3;
        const boot = (w.rigs.bikePoint(0, `peg_${side}`) as Vector3).add(new Vector3(0, 0.075, 0.035));
        expect(hand.distanceTo(bar), `${side} hand`).toBeLessThan(0.06);
        expect(ankle.distanceTo(boot), `${side} foot`).toBeLessThan(0.06);
      }
    },
  );

  it('clears the pose when the signature ends, retaining every neutral rider bone', () => {
    const neutral = measured(null);
    const w = world();
    w.pose(sig('tell'));
    w.pose(sig('act'));
    w.pose(sig('open'));
    w.pose(null);
    for (const bone of RIDER_BONES) {
      expect(w.position(bone).distanceTo(neutral.position(bone)), `${bone} position`).toBeLessThan(1e-7);
      expect(w.rotation(bone).angleTo(neutral.rotation(bone)), `${bone} rotation`).toBeLessThan(1e-7);
    }
    const seat = seating(riderFrame(fakeRider()), bikeFrame(fakeBike()));
    expect(neutral.forwardTilt('chest')).toBeCloseTo(seat.chestLean, 8);
    expect(neutral.position('hips').distanceTo(seat.hips)).toBeLessThan(1e-8);
    expect(
      neutral
        .rotation('head')
        .angleTo(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.12 * seat.chestLean)),
    ).toBeLessThan(1e-7);
  });

  it.each(['tell', 'act', 'open'] as const)(
    'retains the existing non-Timber counter geometry during %s',
    (phase) => {
      const neutral = measured(null);
      // Mother Rust now owns redesigned ram geometry, including ordinary ram appearances.
      // Keep this independent non-Timber baseline on an unchanged signature instead.
      const counter = measured(sig(phase, 0, 'counter'));
      const seat = seating(riderFrame(fakeRider()), bikeFrame(fakeBike()));
      const expected = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -seat.chestLean);
      expect(counter.rotation('chest').angleTo(expected)).toBeLessThan(1e-7);
      expect(counter.position('hips').distanceTo(neutral.position('hips'))).toBeLessThan(1e-8);
      const head = new Quaternion()
        .setFromAxisAngle(new Vector3(0, 1, 0), phase === 'tell' ? -1.3 : 0)
        .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.12 * seat.chestLean));
      expect(counter.rotation('head').angleTo(head)).toBeLessThan(1e-7);
    },
  );
});
