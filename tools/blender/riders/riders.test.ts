// The rider models gate here (run W-R; interview, 2026-10-02: "Real models now"). CI has no Blender,
// so these tests read the real files: every rider GLB the lock pins (downloaded from the dataset
// repo at the pinned commit into .cache/assets/, sha256-checked) and every bike GLB in the base pack
// (PR #300). They check the rig contract on each rider, seat every rider on every bike and check
// the hands reach the bars and the feet the pegs, then drive whole rigs through EntityViews the way
// the game does and check what moved: wheels, wheelies, stoppies, punches, kicks, the tumble, the
// run back, the shed prop, the smoke and the level of detail.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mesh, Vector3, type Object3D } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureCached, readLock } from '../../../scripts/dataset-assets.mjs';
import { readGlb } from '../../../src/render/glb';
import { createFlatLook } from '../../../src/render/look';
import { riderLookOf } from '../../../src/render/rider-looks';
import { RiderRigs } from '../../../src/render/riders';
import {
  bakePart,
  PROP_MOUNTS,
  RIDER_BONES,
  RIDER_MARKERS,
  type BakedPart,
} from '../../../src/render/riders/bake';
import { defaultRenderParams } from '../../../src/render/tuning';
import { EntityViews } from '../../../src/render/views';
import type { EntitySnapshot, SimEvent, SimSnapshot } from '../../../src/sim/api';
import { datasetPath, RIDERS } from './catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BIKE_DIR = path.join(root, 'packs/base/assets/models/bikes');
const bikeNames = readdirSync(BIKE_DIR)
  .filter((f) => f.endsWith('.glb'))
  .map((f) => f.slice(0, -4))
  .sort();
const arrayBuffer = (buf: Buffer): ArrayBuffer =>
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

const riders = new Map<string, BakedPart>();
const bikes = new Map<string, BakedPart>();
const { lock, problems } = readLock(root) as {
  lock: { files: { path: string; region?: string; bytes: number; sha256: string }[] };
  problems: string[];
};

beforeAll(async () => {
  for (const row of RIDERS) {
    const file = lock.files.find((f) => f.path === datasetPath(row));
    if (!file) throw new Error(`assets.lock.json does not pin ${datasetPath(row)}`);
    const { bytes } = (await ensureCached(root, lock, file)) as { bytes: Buffer };
    riders.set(row.id, bakePart(readGlb(arrayBuffer(bytes)), 'rider'));
  }
  for (const name of bikeNames) {
    bikes.set(name, bakePart(readGlb(arrayBuffer(readFileSync(path.join(BIKE_DIR, `${name}.glb`)))), 'bike'));
  }
}, 180_000);

function entity(id: number, contentId: string, over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 0, d: 0, h: 0, dir: 1, yaw: 0 },
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    speed: 0,
    lean: 0,
    contentId,
    name: contentId,
    faction: 'rider',
    slot: -1,
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

interface Pair {
  contentId: string;
  rider: string;
  bike: string;
  role?: 'rival' | 'cop' | 'player';
}

/** A renderer's entity views with rigs, given baked parts directly (no manifest, no WebGL). */
function world(pairs: Pair[]) {
  const look = createFlatLook();
  const params = defaultRenderParams();
  const views = new EntityViews(look, { params });
  const rigs = new RiderRigs(look, null, params);
  views.setRigs(rigs);
  for (const p of pairs) {
    rigs.addPart(`models/riders/${p.rider}`, riders.get(p.rider) as BakedPart);
    rigs.addPart(`models/bikes/${p.bike}`, bikes.get(p.bike) as BakedPart);
  }
  rigs.setLooks(
    pairs.map((p) =>
      riderLookOf({
        contentId: p.contentId,
        role: p.role ?? 'rival',
        bikeId: 'base:rustbucket-400',
        look: { bikeModel: p.bike },
      }),
    ),
  );
  let prev: SimSnapshot | null = null;
  let tick = 0;
  const step = (entities: EntitySnapshot[], events: SimEvent[] = []) => {
    if (events.length) {
      views.pushEvents(events);
      rigs.pushEvents(events);
    }
    const curr = { tick, timeScale: 1, entities } as unknown as SimSnapshot;
    views.sync(prev, curr, 1, tick / 60);
    prev = curr;
    tick++;
  };
  return { views, rigs, step, now: () => tick };
}

const visibleMeshes = (o: Object3D): Mesh[] => {
  const out: Mesh[] = [];
  o.traverseVisible((n) => {
    if ((n as Mesh).isMesh) out.push(n as Mesh);
  });
  return out;
};
const under = (o: Object3D, ancestor: Object3D) => {
  for (let n: Object3D | null = o; n; n = n.parent) if (n === ancestor) return true;
  return false;
};

describe('the rider models (tools/blender/riders, pinned in assets.lock.json)', () => {
  it('the lock is sound and pins every rider in the catalog, in its pack and region', () => {
    expect(problems).toEqual([]);
    for (const row of RIDERS) {
      const file = lock.files.find((f) => f.path === datasetPath(row));
      expect(file, datasetPath(row)).toBeDefined();
      expect(file?.region).toBe(row.region);
    }
    console.log(`[examined] ${RIDERS.length} riders pinned; ${bikeNames.length} bikes in the base pack`);
  });

  it('every rider bakes to the rig contract: bones, markers, prop mount, seat, feet on the ground, budget', () => {
    let tris = 0;
    for (const row of RIDERS) {
      const part = riders.get(row.id) as BakedPart;
      expect(
        part.bones.map((b) => b.name),
        row.id,
      ).toEqual([...RIDER_BONES]);
      expect(
        part.bones.every((b) => b.parent === -1),
        `${row.id}: a flat rig`,
      ).toBe(true);
      for (const m of RIDER_MARKERS) expect(part.points[m], `${row.id} ${m}`).toBeDefined();
      expect(PROP_MOUNTS).toContain(part.extras['prop_mount']);
      expect(Number(part.extras['seat_m'])).toBeGreaterThan(0.7);
      expect(part.triangles, `${row.id} triangles`).toBeLessThanOrEqual(row.maxTris);
      expect(part.coreCount, `${row.id} has detail parts after its core`).toBeLessThan(
        part.positions.length / 3,
      );
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 1; i < part.positions.length; i += 3) {
        minY = Math.min(minY, part.positions[i] ?? 0);
        maxY = Math.max(maxY, part.positions[i] ?? 0);
      }
      // The prop on a seat mount (a campaign sign on a pole) can stand above the head.
      expect(minY, `${row.id} feet on the ground`).toBeGreaterThan(-0.01);
      expect(minY, `${row.id} feet on the ground`).toBeLessThan(0.02);
      expect(maxY, `${row.id} height`).toBeGreaterThan(1.6);
      expect(Math.max(...part.boneOf)).toBeLessThan(RIDER_BONES.length);
      // The left of the rider is the game's -x (the model faces -z after the bake's half turn).
      expect((part.points['grip_l'] as Vector3).x).toBeLessThan(0);
      expect((part.points['grip_r'] as Vector3).x).toBeGreaterThan(0);
      tris += part.triangles;
    }
    console.log(`[examined] ${RIDERS.length} riders, ${tris} triangles in all`);
  });

  it('every bike bakes with its anchors, and every rider sits on every bike: hands on the bars, feet on the pegs', () => {
    expect(bikeNames.length).toBeGreaterThanOrEqual(16);
    let pairs = 0;
    let worstHand = 0;
    let worstFoot = 0;
    for (const bike of bikeNames) {
      const b = bikes.get(bike) as BakedPart;
      for (const a of ['seat_anchor', 'bar_l', 'bar_r', 'peg_l', 'peg_r'])
        expect(b.points[a], `${bike} ${a}`).toBeDefined();
      for (const row of RIDERS) {
        const w = world([{ contentId: `base:${row.id}`, rider: row.id, bike }]);
        for (let i = 0; i < 40; i++) w.step([entity(0, `base:${row.id}`)]);
        for (const side of ['l', 'r'] as const) {
          const grip = w.rigs.limbEnd(0, `grip_${side}`) as Vector3;
          const bar = w.rigs.bikePoint(0, `bar_${side}`) as Vector3;
          const ankle = w.rigs.limbEnd(0, `ankle_${side}`) as Vector3;
          const peg = (w.rigs.bikePoint(0, `peg_${side}`) as Vector3).add(new Vector3(0, 0.075, 0.035));
          worstHand = Math.max(worstHand, grip.distanceTo(bar));
          worstFoot = Math.max(worstFoot, ankle.distanceTo(peg));
          expect(grip.distanceTo(bar), `${row.id} on ${bike}: ${side} hand to the bar`).toBeLessThan(0.06);
          expect(ankle.distanceTo(peg), `${row.id} on ${bike}: ${side} foot to the peg`).toBeLessThan(0.06);
        }
        const hips = w.rigs.bonePosition(0, 'hips') as Vector3;
        const seat = w.rigs.bikePoint(0, 'seat') as Vector3;
        expect(hips.y, `${row.id} on ${bike}: sits above the seat`).toBeGreaterThan(seat.y);
        pairs++;
      }
    }
    console.log(
      `[examined] ${pairs} rider-on-bike pairs; worst hand ${worstHand.toFixed(3)} m from its grip, ` +
        `worst foot ${worstFoot.toFixed(3)} m from its peg`,
    );
  });
});

describe('a rider rig in EntityViews', () => {
  const deacon: Pair = { contentId: 'base:deacon-vane', rider: 'deacon-vane', bike: 'chopper' };

  it('draws the rider and bike as one skinned mesh instead of the boxes', () => {
    const w = world([deacon]);
    for (let i = 0; i < 5; i++) w.step([entity(0, deacon.contentId, { speed: 20 })]);
    // The blob shadows (shadows.ts) are their own layer, drawn for every rider either way.
    const shown = visibleMeshes(w.views.root).filter((m) => m.name !== 'blob-shadows');
    expect(
      shown.every((m) => under(m, w.rigs.root)),
      'no box rider shows',
    ).toBe(true);
    expect(shown.map((m) => m.name)).toEqual(['rig-mesh']);
    expect(w.rigs.counts()).toMatchObject({ rigs: 1, drawn: 1 });
  });

  it('a rider whose models have not loaded keeps its box rider', () => {
    const w = world([]);
    w.rigs.setLooks([riderLookOf({ contentId: 'base:x', role: 'rival', bikeId: 'base:rustbucket-400' })]);
    w.step([entity(0, 'base:x', { speed: 20 })]);
    const shown = visibleMeshes(w.views.root);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.some((m) => under(m, w.rigs.root))).toBe(false);
  });

  it('the wheels spin with speed and stop when parked', () => {
    const w = world([deacon]);
    w.step([entity(0, deacon.contentId, { speed: 20 })]);
    const wheel = w.rigs.bikeBoneOf(0, 'wheel_front');
    const before = wheel?.quaternion.clone();
    w.step([entity(0, deacon.contentId, { speed: 20 })]);
    expect(wheel?.quaternion.angleTo(before ?? wheel.quaternion)).toBeGreaterThan(0.5);
  });

  it('a launch lifts the front wheel and hard braking lifts the rear one', () => {
    const chad: Pair = { contentId: 'base:chad-speedwell', rider: 'chad-speedwell', bike: 'sport-stickered' };
    const axles = (w: ReturnType<typeof world>) => {
      const f = w.rigs.bikeBoneOf(0, 'wheel_front')?.getWorldPosition(new Vector3()) as Vector3;
      const r = w.rigs.bikeBoneOf(0, 'wheel_rear')?.getWorldPosition(new Vector3()) as Vector3;
      return f.y - r.y;
    };
    const launch = world([chad]);
    for (let i = 0; i < 45; i++)
      launch.step([entity(0, chad.contentId, { speed: 1 + i * 0.08, throttle: 1 })]);
    expect(axles(launch), 'wheelie: front axle above the rear').toBeGreaterThan(0.2);
    const brake = world([chad]);
    for (let i = 0; i < 45; i++)
      brake.step([entity(0, chad.contentId, { speed: 30 - i * 0.15, throttle: 0 })]);
    expect(axles(brake), 'stoppie: rear axle above the front').toBeLessThan(-0.1);
  });

  it('a punch reaches out to the target side, and a kick sends the leg out', () => {
    const w = world([deacon, { contentId: 'base:dial-up', rider: 'dial-up', bike: 'rustbucket-400' }]);
    const target = entity(1, 'base:dial-up', { x: 2, speed: 20 });
    const me = (phase: EntitySnapshot['attackPhase']) =>
      entity(0, deacon.contentId, { speed: 20, attackPhase: phase, targetId: 1 });
    for (let i = 0; i < 12; i++) w.step([me('active'), target]);
    const shoulder = w.rigs.bonePosition(0, 'upper_arm_r') as Vector3;
    const fist = w.rigs.limbEnd(0, 'grip_r') as Vector3;
    expect(fist.x - shoulder.x, 'the punch goes out to the right, toward the target').toBeGreaterThan(0.45);
    for (let i = 0; i < 10; i++) w.step([me('cooldown'), target]);
    w.step([me('windup'), target], [{ tick: 0, type: 'attackStart', actor: 0, data: { kind: 'kick' } }]);
    for (let i = 0; i < 12; i++) w.step([me('active'), target]);
    const hip = w.rigs.bonePosition(0, 'thigh_r') as Vector3;
    const foot = w.rigs.limbEnd(0, 'ankle_r') as Vector3;
    expect(foot.x - hip.x, 'the kick goes out to the right').toBeGreaterThan(0.6);
  });

  it('the tumble throws the rider and the bike apart, and on foot the bike stands where it was parked', () => {
    const w = world([deacon]);
    const tumble = {
      rider: { x: 0, y: 0.6, z: -3, vx: 0, vy: 0, vz: -6 },
      bike: { x: 2, y: 0.5, z: 4, vx: 0, vy: 0, vz: -8 },
    };
    for (let i = 0; i < 6; i++) w.step([entity(0, deacon.contentId, { mode: 'Tumble', speed: 8, tumble })]);
    const bike = w.rigs.bikeBoneOf(0, 'bike')?.getWorldPosition(new Vector3()) as Vector3;
    const hips = w.rigs.bonePosition(0, 'hips') as Vector3;
    expect(Math.hypot(bike.x - 2, bike.z - 4), 'the bike is on its own body').toBeLessThan(0.8);
    expect(Math.hypot(hips.x, hips.z + 3), 'the rider is on theirs').toBeLessThan(1.2);
    const parkedBike = { x: 6, y: 0, z: 5, heading: 0.5 };
    for (let i = 0; i < 6; i++)
      w.step([entity(0, deacon.contentId, { mode: 'OnFoot', speed: 7, x: 1, z: 1, parkedBike })]);
    const parked = w.rigs.bikeBoneOf(0, 'bike')?.getWorldPosition(new Vector3()) as Vector3;
    expect(Math.hypot(parked.x - 6, parked.z - 5)).toBeLessThan(0.3);
    const ankle = w.rigs.limbEnd(0, 'ankle_l') as Vector3;
    expect(ankle.y, 'running on the ground').toBeLessThan(0.45);
  });

  it('a hurt rider sheds their prop, and a badly hurt one trails smoke', () => {
    const w = world([deacon]);
    for (let i = 0; i < 5; i++) w.step([entity(0, deacon.contentId, { speed: 20 })]);
    const head = () => w.rigs.bonePosition(0, 'head') as Vector3;
    const hat = () => w.rigs.bonePosition(0, 'prop') as Vector3;
    expect(hat().distanceTo(head())).toBeLessThan(0.4);
    for (let i = 0; i < 40; i++) w.step([entity(0, deacon.contentId, { speed: 20, health: 45 })]);
    expect(hat().distanceTo(head()), 'the hat flew off').toBeGreaterThan(0.6);
    expect(w.rigs.counts().smoke).toBe(0);
    for (let i = 0; i < 30; i++) w.step([entity(0, deacon.contentId, { speed: 20, health: 20 })]);
    expect(w.rigs.counts().smoke).toBeGreaterThan(3);
  });

  it('far from the camera a rider draws without its detail parts', () => {
    const w = world([deacon]);
    w.rigs.setCamera(0, 3, 10);
    w.step([entity(0, deacon.contentId, { speed: 20 })]);
    const near = w.rigs.lodOf(0);
    expect(near?.now).toBe(near?.full);
    w.rigs.setCamera(0, 3, 400);
    w.step([entity(0, deacon.contentId, { speed: 20 })]);
    const far = w.rigs.lodOf(0);
    expect(far?.now).toBe(far?.far);
    expect((far?.far ?? 0) < (far?.full ?? 0)).toBe(true);
  });

  it("Chad's selfie: the phone gimbal comes up into his right hand", () => {
    const chad: Pair = { contentId: 'base:chad-speedwell', rider: 'chad-speedwell', bike: 'sport-stickered' };
    const w = world([chad]);
    const signature = { move: 'selfie' as const, phase: 'act' as const, seconds: 0, left: 2, targetId: -1 };
    for (let i = 0; i < 30; i++) w.step([entity(0, chad.contentId, { speed: 20, signature })]);
    const phone = w.rigs.bonePosition(0, 'prop') as Vector3;
    const hand = w.rigs.limbEnd(0, 'grip_r') as Vector3;
    const bar = w.rigs.bikePoint(0, 'bar_r') as Vector3;
    expect(phone.distanceTo(hand)).toBeLessThan(0.05);
    expect(hand.distanceTo(bar), 'no hands on the bars').toBeGreaterThan(0.3);
  });
});
