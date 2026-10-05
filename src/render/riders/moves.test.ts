// The moves on screen (playtest 3, T2.4): the wheelie from the sim's own angle (not the rig's
// acceleration guess), the drift's slide with the inside knee down, a backflip's and a front flip's
// own postures, and the rubber a slide leaves (skids.ts). The rig is driven the way the game drives
// it (EntityViews + RiderRigs on hand-built baked parts, no WebGL, no downloaded models, so this
// runs everywhere); tools/blender/riders/riders.test.ts keeps the real-model checks.
import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../sim/api';
import { createFlatLook } from '../look';
import { riderLookOf } from '../rider-looks';
import { SKID_QUADS } from '../skids';
import { defaultRenderParams } from '../tuning';
import { EntityViews } from '../views';
import { RiderRigs } from './index';
import { fakeBike, fakeRider, v } from './rig-fixtures.test-util';

const ID = 'base:player';

function entity(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
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
    name: 'player',
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
    ...over,
  };
}

function world() {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const views = new EntityViews(look, { params });
  const rigs = new RiderRigs(look, null, params);
  views.setRigs(rigs);
  rigs.addPart('models/riders/player', fakeRider());
  rigs.addPart('models/bikes/sport', fakeBike());
  rigs.setLooks([
    riderLookOf({
      contentId: ID,
      role: 'rival',
      bikeId: 'base:sport',
      look: { bikeModel: 'sport' },
    }),
  ]);
  let prev: SimSnapshot | null = null;
  let tick = 0;
  const step = (e: EntitySnapshot, events: SimEvent[] = []) => {
    if (events.length) {
      views.pushEvents(events);
      rigs.pushEvents(events);
    }
    const curr = { tick, timeScale: 1, entities: [e] } as unknown as SimSnapshot;
    views.sync(prev, curr, 1, tick / 60);
    rigs.endFrame(1 / 60);
    prev = curr;
    tick++;
  };
  /** Holds a pose for `n` ticks, enough for every easing to settle. */
  const hold = (e: EntitySnapshot, n = 50) => {
    for (let i = 0; i < n; i++) step(e);
  };
  /** A world point in the bike's own frame (x right, y up, forward -z). */
  const inBike = (p: Vector3): Vector3 => {
    const bone = rigs.bikeBoneOf(0, 'bike');
    if (!bone) throw new Error('no bike bone');
    rigs.root.updateMatrixWorld(true);
    return p.clone().applyMatrix4(new Matrix4().copy(bone.matrixWorld).invert());
  };
  const at = (name: Parameters<RiderRigs['bonePosition']>[1]) =>
    inBike(rigs.bonePosition(0, name) as Vector3);
  const worldAt = (name: Parameters<RiderRigs['bonePosition']>[1]) => rigs.bonePosition(0, name) as Vector3;
  const axle = (n: 'wheel_front' | 'wheel_rear') =>
    rigs.bikeBoneOf(0, n)?.getWorldPosition(new Vector3()) as Vector3;
  const forward = () => {
    rigs.root.updateMatrixWorld(true);
    const bone = rigs.bikeBoneOf(0, 'bike');
    return new Vector3(0, 0, -1).transformDirection(bone?.matrixWorld ?? new Matrix4());
  };
  /** Which way a rider bone's up leans in the bike's frame, radians: above 0 is tilted back (toward the tail). */
  const tilt = (name: Parameters<RiderRigs['boneRotation']>[1]): number => {
    const q = rigs.boneRotation(0, name) as Quaternion;
    const bikeQ = rigs.bikeBoneOf(0, 'bike')?.getWorldQuaternion(new Quaternion()) as Quaternion;
    const up = new Vector3(0, 1, 0).applyQuaternion(bikeQ.clone().invert().multiply(q));
    return Math.atan2(up.z, up.y);
  };
  /** Where a boot rests: its peg plus 0.075 up and 0.035 back in the bike's own (tipped) frame. */
  const boot = (side: 'l' | 'r'): Vector3 => {
    const peg = rigs.bikePoint(0, `peg_${side}`) as Vector3;
    const q = rigs.bikeBoneOf(0, 'bike')?.getWorldQuaternion(new Quaternion()) as Quaternion;
    return peg.add(v(0, 0.075, 0.035).applyQuaternion(q));
  };
  return { views, rigs, step, hold, at, worldAt, inBike, axle, forward, tilt, boot };
}

describe('the fixture is a rider on a bike: hands on the bars, feet on the pegs', () => {
  it('seated, both hands reach the bars and both feet the pegs', () => {
    const w = world();
    w.hold(entity());
    for (const side of ['l', 'r'] as const) {
      const grip = w.rigs.limbEnd(0, `grip_${side}`) as Vector3;
      const bar = w.rigs.bikePoint(0, `bar_${side}`) as Vector3;
      expect(grip.distanceTo(bar), `${side} hand`).toBeLessThan(0.06);
      const ankle = w.rigs.limbEnd(0, `ankle_${side}`) as Vector3;
      const peg = w.boot(side);
      expect(ankle.distanceTo(peg), `${side} foot`).toBeLessThan(0.06);
    }
  });
});

describe('the wheelie: drawn from the sim own angle', () => {
  it('the front rises by the snapshot angle about the rear tyre, which stays on the road', () => {
    const level = world();
    level.hold(entity({ throttle: 0.5 }));
    const flat = level.axle('wheel_front').y - level.axle('wheel_rear').y;
    expect(Math.abs(flat)).toBeLessThan(0.02);

    const up = world();
    // No acceleration and a middling throttle: the rig's old guess would draw nothing at all.
    up.hold(entity({ throttle: 0.55, wheelie: 0.6 }));
    const rise = up.axle('wheel_front').y - up.axle('wheel_rear').y;
    expect(rise, '1.4 m wheelbase x sin 0.6 is about 0.79 m').toBeGreaterThan(0.7);
    expect(rise).toBeLessThan(0.9);
    // The rear contact point stays on the ground.
    const contact = up.rigs.bikeBoneOf(0, 'wheel_rear')?.getWorldPosition(new Vector3()) as Vector3;
    expect(contact.y - 0.32 * Math.cos(0.6), 'the rear tyre is still on the road').toBeLessThan(0.03);
  });

  it('follows the sim angle up and down, not its own timer', () => {
    const w = world();
    const rise = () => w.axle('wheel_front').y - w.axle('wheel_rear').y;
    w.hold(entity({ wheelie: 0.3 }), 40);
    const low = rise();
    w.hold(entity({ wheelie: 0.9 }), 40);
    const high = rise();
    w.hold(entity({ wheelie: 0 }), 60);
    const down = rise();
    expect(high).toBeGreaterThan(low + 0.3);
    expect(Math.abs(down)).toBeLessThan(0.05);
  });

  it('the rider sits back with his head up and keeps his hands on the bars', () => {
    const level = world();
    level.hold(entity());
    const up = world();
    up.hold(entity({ wheelie: 0.6 }));
    // In the bike's frame the chest leans back as far as the arms allow, which is a hand's breadth
    // (the arms are nearly straight): the head ends up further back (+z), and the chest tilts back.
    expect(up.at('head').z, 'head further back').toBeGreaterThan(level.at('head').z + 0.02);
    expect(up.tilt('chest'), 'chest tilted back').toBeGreaterThan(level.tilt('chest') + 0.05);
    for (const side of ['l', 'r'] as const) {
      const grip = up.rigs.limbEnd(0, `grip_${side}`) as Vector3;
      const bar = up.rigs.bikePoint(0, `bar_${side}`) as Vector3;
      expect(grip.distanceTo(bar), `${side} hand stays on the bar`).toBeLessThan(0.08);
    }
  });

  it('a hood launch hands the pose back: in the air the wheelie is gone at once, not eased out', () => {
    const w = world();
    w.hold(entity({ wheelie: 0.7 }), 40);
    // The sim launches: the angle moves into the flight's pitch, which views draws.
    w.step(entity({ mode: 'Airborne', grounded: false, y: 1, wheelie: 0, pitch: 0.7, trick: 'backflip' }));
    const rig = w.axle('wheel_front').y - w.axle('wheel_rear').y;
    // 0.7 rad of pitch drawn once is about 0.9 m; twice would be about 1.37 m.
    expect(rig).toBeLessThan(1.05);
  });

  it('the launch estimate still lifts a rival off the line (no sim wheelie)', () => {
    const w = world();
    for (let i = 0; i < 45; i++) w.step(entity({ speed: 1 + i * 0.08, throttle: 1 }));
    expect(w.axle('wheel_front').y - w.axle('wheel_rear').y).toBeGreaterThan(0.2);
  });
});

describe('the drift: the bike slides, the inside knee comes down', () => {
  const sliding = (side: 1 | -1, over: Partial<EntitySnapshot> = {}) =>
    entity({ drift: 0.5 * side, lean: 0.8 * side, speed: 28, ...over });

  it('draws the nose to the side of the slip, past the heading', () => {
    const straight = world();
    straight.hold(entity({ lean: 0.8, speed: 28 }));
    expect(Math.abs(straight.forward().x)).toBeLessThan(0.02);

    const right = world();
    right.hold(sliding(1));
    // Heading 0 faces -z; the slip is positive when the nose points to the right (+x).
    expect(right.forward().x).toBeGreaterThan(0.4);
    expect(right.forward().x).toBeLessThan(0.55);

    const left = world();
    left.hold(sliding(-1));
    expect(left.forward().x).toBeLessThan(-0.4);
  });

  it('slides the bike about its middle: the rear tyre swings out, the front one the other way', () => {
    const straight = world();
    straight.hold(entity({ lean: 0.8, speed: 28 }));
    const slide = world();
    slide.hold(sliding(1));
    const dRear = slide.axle('wheel_rear').x - straight.axle('wheel_rear').x;
    const dFront = slide.axle('wheel_front').x - straight.axle('wheel_front').x;
    expect(dRear, 'the tail steps out to the left').toBeLessThan(-0.15);
    expect(dFront, 'the nose to the right').toBeGreaterThan(0.15);
  });

  it('puts the inside knee out and down, and shifts the hips inside; the outside leg stays', () => {
    const base = world();
    base.hold(entity({ lean: 0.8, speed: 28 }));
    const knee = world();
    knee.hold(sliding(1));
    const inside = knee.at('shin_r').clone().sub(base.at('shin_r'));
    expect(inside.x, 'the right knee is further out to the right').toBeGreaterThan(0.08);
    expect(inside.y, 'and lower').toBeLessThan(-0.02);
    const hips = knee.at('hips').x - base.at('hips').x;
    expect(hips, 'hips shifted about 0.1 m inside').toBeGreaterThan(0.07);
    expect(hips).toBeLessThan(0.14);
    const outside = knee.at('shin_l').clone().sub(base.at('shin_l'));
    // The outside knee only follows the hips; it does not go out.
    expect(outside.x, 'the left knee goes no further left').toBeGreaterThan(-0.03);

    const mirror = world();
    mirror.hold(sliding(-1));
    const m = mirror.at('shin_l').clone().sub(base.at('shin_l'));
    expect(m.x, 'a left drift is the mirror: the left knee out to the left').toBeLessThan(-0.08);
    expect(m.y).toBeLessThan(-0.02);
  });

  it('keeps both feet on the pegs and both hands on the bars through the slide', () => {
    const w = world();
    w.hold(sliding(1));
    for (const side of ['l', 'r'] as const) {
      const grip = w.rigs.limbEnd(0, `grip_${side}`) as Vector3;
      const bar = w.rigs.bikePoint(0, `bar_${side}`) as Vector3;
      expect(grip.distanceTo(bar), `${side} hand`).toBeLessThan(0.1);
      const ankle = w.rigs.limbEnd(0, `ankle_${side}`) as Vector3;
      const peg = w.boot(side);
      expect(ankle.distanceTo(peg), `${side} foot`).toBeLessThan(0.1);
    }
  });

  it('no knee below the thresholds: a small slip or a light lean leaves the rider seated', () => {
    const base = world();
    base.hold(entity({ lean: 0.8, speed: 28 }));
    const smallSlip = world();
    smallSlip.hold(entity({ drift: 0.15, lean: 0.8, speed: 28 }));
    expect(smallSlip.at('shin_r').distanceTo(base.at('shin_r'))).toBeLessThan(0.02);
    // A light lean (the bike still slides; only the knee is held back).
    const lightLean = world();
    lightLean.hold(entity({ drift: 0.5, lean: 0.4, speed: 28 }));
    const lightBase = world();
    lightBase.hold(entity({ lean: 0.4, speed: 28 }));
    expect(lightLean.at('shin_r').distanceTo(lightBase.at('shin_r'))).toBeLessThan(0.02);
  });

  it('is off in the air and on foot', () => {
    const w = world();
    w.hold(entity({ mode: 'Airborne', grounded: false, y: 2, drift: 0.5, lean: 0.8, pitch: 0 }));
    expect(Math.abs(w.forward().x), 'no slide drawn in the air').toBeLessThan(0.05);
  });
});

describe('the flips: a backflip and a front flip each have their own posture', () => {
  const flipping = (trick: 'backflip' | 'frontflip' | null) =>
    entity({ mode: 'Airborne', grounded: false, y: 3, pitch: 0, trick, speed: 22 });

  it('a backflip sits back with the head thrown back; a front flip hunches forward', () => {
    const back = world();
    back.hold(flipping('backflip'), 40);
    const front = world();
    front.hold(flipping('frontflip'), 40);
    const plain = world();
    plain.hold(flipping(null), 40);
    expect(back.at('head').z, 'backflip: the body is behind the plain flight').toBeGreaterThan(
      plain.at('head').z + 0.02,
    );
    expect(front.tilt('chest'), 'front flip: hunched over the bars').toBeLessThan(plain.tilt('chest') - 0.4);
    expect(back.tilt('chest'), 'backflip: sat back').toBeGreaterThan(plain.tilt('chest') + 0.05);
    expect(back.tilt('head'), 'backflip: head thrown back').toBeGreaterThan(plain.tilt('head') + 0.3);
    expect(front.tilt('head'), 'front flip: chin down').toBeLessThan(plain.tilt('head') - 0.45);
  });

  it('holds on through a backflip: hands on the bars, feet on the pegs', () => {
    const w = world();
    w.hold(flipping('backflip'), 40);
    for (const side of ['l', 'r'] as const) {
      const grip = w.rigs.limbEnd(0, `grip_${side}`) as Vector3;
      const bar = w.rigs.bikePoint(0, `bar_${side}`) as Vector3;
      expect(grip.distanceTo(bar), `${side} hand`).toBeLessThan(0.1);
      const ankle = w.rigs.limbEnd(0, `ankle_${side}`) as Vector3;
      const peg = w.boot(side);
      expect(ankle.distanceTo(peg), `${side} foot`).toBeLessThan(0.1);
    }
  });
});

describe('the rubber a slide leaves', () => {
  const sliding = (x: number, z: number, over: Partial<EntitySnapshot> = {}) =>
    entity({ x, z, heading: 0, drift: 0.5, lean: 0.8, speed: 28, ...over });

  it('a drift lays a mark under the rear tyre, and smoke, as the bike rolls on', () => {
    const w = world();
    for (let i = 0; i < 90; i++) w.step(sliding(0, -i * 0.47));
    const counts = w.rigs.counts();
    expect(counts.skids, 'quads laid').toBeGreaterThan(30);
    expect(counts.tyreSmoke, 'puffs up').toBeGreaterThan(4);
    const skids = w.rigs.skidsMesh();
    expect(skids.visible).toBe(true);
    // The mark runs along the road (z) and sits on the rear tyre's line, a tail's swing off centre.
    const pos = skids.geometry.getAttribute('position').array as Float32Array;
    const rearX = w.axle('wheel_rear').x;
    const last = (counts.skids - 1) * 12;
    expect(Math.abs(((pos[last + 6] as number) + (pos[last + 9] as number)) / 2 - rearX)).toBeLessThan(0.4);
    expect(pos[last + 7] as number, 'on the road, lifted a hair').toBeGreaterThan(0);
    expect(pos[last + 7] as number).toBeLessThan(0.1);
  });

  it('a stoppie marks the front tyre; plain riding marks nothing and both meshes stay hidden', () => {
    const calm = world();
    for (let i = 0; i < 60; i++) calm.step(entity({ z: -i * 0.4, speed: 24 }));
    expect(calm.rigs.counts().skids).toBe(0);
    expect(calm.rigs.skidsMesh().visible).toBe(false);
    expect(calm.rigs.tyreSmokeMesh().visible).toBe(false);

    const hard = world();
    // Hard braking from 30 m/s: the speed falls 9 m/s each second, as the sim's brake does.
    for (let i = 0; i < 80; i++) hard.step(entity({ z: -i * 0.4, speed: 32 - i * 0.15 }));
    expect(hard.rigs.counts().skids, 'a stoppie leaves a mark').toBeGreaterThan(5);
  });

  it('the air breaks the mark, and no mark is laid while airborne', () => {
    const w = world();
    for (let i = 0; i < 30; i++) w.step(sliding(0, -i * 0.47));
    const before = w.rigs.counts().skids;
    for (let i = 30; i < 60; i++)
      w.step(sliding(0, -i * 0.47, { mode: 'Airborne', grounded: false, y: 2, pitch: 0 }));
    expect(w.rigs.counts().skids).toBe(before);
  });

  it('a new race (setLooks) wipes the old marks', () => {
    const w = world();
    for (let i = 0; i < 40; i++) w.step(sliding(0, -i * 0.47));
    expect(w.rigs.counts().skids).toBeGreaterThan(0);
    w.rigs.setLooks([
      riderLookOf({ contentId: ID, role: 'rival', bikeId: 'base:sport', look: { bikeModel: 'sport' } }),
    ]);
    expect(w.rigs.counts().skids).toBe(0);
  });

  it('adds two draw calls at most: the ribbon and the smoke, and nothing grows without bound', () => {
    const w = world();
    for (let i = 0; i < 1500; i++) w.step(sliding(0, -i * 0.47));
    const counts = w.rigs.counts();
    expect(counts.skids).toBe(SKID_QUADS);
    expect(counts.tyreSmoke).toBeLessThanOrEqual(48);
    const meshes: string[] = [];
    w.rigs.skidsRoot().traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) meshes.push(o.name);
    });
    expect(meshes.sort()).toEqual(['skid-marks', 'tyre-smoke']);
  });
});
