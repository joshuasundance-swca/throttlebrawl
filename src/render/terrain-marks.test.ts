import { InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { AirPays } from './air-pays';
import { createFlatLook } from './look';
import { riderLookOf } from './rider-looks';
import { RiderRigs } from './riders';
import { fakeBike, fakeRider } from './riders/rig-fixtures.test-util';
import { boxAt, planOfBoxes } from './roof-fit.test-util';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';

function road(terrain = true): RoadNetwork {
  const bundle = fixtureNetwork([{ id: 'road', lengthM: 200, kappa: 0 }]);
  return createRoadNetwork({
    ...bundle,
    network: {
      ...bundle.network,
      ...(terrain
        ? {
            terrain: {
              patches: [
                {
                  surface: 'grass' as const,
                  vertices: [
                    [-20, -5, -150],
                    [-20, -15, -50],
                    [40, 25, -150],
                    [40, 15, -50],
                  ] as [number, number, number][],
                  triangles: [
                    [0, 1, 2],
                    [2, 1, 3],
                  ] as [number, number, number][],
                },
              ],
            },
          }
        : {}),
    },
  });
}

function entity(over: Partial<EntitySnapshot> = {}): EntitySnapshot {
  return {
    id: 7,
    kind: 'rider',
    mode: 'Road',
    road: { edge: 0, s: 100, d: 20, h: 0, dir: 1, yaw: 0 },
    x: 20,
    y: 10,
    z: -100,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId: 'base:player',
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
const snap = (e: EntitySnapshot): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities: [e],
  race: { over: false, routeLength: 200, finishOrder: [] },
});
const normal = new Vector3(-0.5, 1, 0.1).normalize();

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
      contentId: 'base:player',
      role: 'rival',
      bikeId: 'base:sport',
      look: { bikeModel: 'sport' },
    }),
  ]);
  let tick = 0;
  const draw = (e: EntitySnapshot) => {
    const s = snap(e);
    views.sync(s, s, 1, tick++ / 60);
    rigs.endFrame(1 / 60);
    rigs.root.updateMatrixWorld(true);
  };
  const bikeDirection = (v: Vector3) => {
    const bone = rigs.bikeBoneOf(7, 'bike');
    if (!bone) throw new Error('missing identity-bound rider bike');
    return v.transformDirection(bone.matrixWorld);
  };
  const shadows = views.root.getObjectByName('blob-shadows');
  if (!(shadows instanceof InstancedMesh)) throw new Error('missing shadows');
  return { views, rigs, draw, bikeDirection, shadows };
}

describe('authored land presentation', () => {
  it.each([0, Math.PI, 0.7])('fits the actual bike frame to the source plane at heading %s', (heading) => {
    const w = world();
    w.views.setRoad(road());
    w.draw(entity({ heading, pitch: 1.2 }));
    expect(w.bikeDirection(new Vector3(0, 1, 0)).distanceTo(normal)).toBeLessThan(1e-5);
    expect(w.bikeDirection(new Vector3(0, 0, -1)).dot(normal)).toBeCloseTo(0, 6);
  });

  it('adds the rig wheelie once to the land frame, independent of the combined sim pitch', () => {
    const w = world();
    w.views.setRoad(road());
    for (let i = 0; i < 100; i++) w.draw(entity({ wheelie: 0.6, pitch: 1.4 }));
    const forward = w.bikeDirection(new Vector3(0, 0, -1));
    expect(Math.asin(forward.dot(normal))).toBeCloseTo(0.6, 3);
  });

  it('keeps air attitude and legacy, actual road, roof and replaced-road controls', () => {
    const w = world();
    const source = road();
    w.views.setRoad(source);
    w.draw(entity({ mode: 'Airborne', grounded: false, pitch: 0.4 }));
    expect(w.bikeDirection(new Vector3(0, 0, -1)).y).toBeCloseTo(Math.sin(0.4), 5);
    for (const next of [null, road(false)]) {
      w.views.setRoad(next);
      w.draw(entity({ pitch: 1.2 }));
      expect(w.bikeDirection(new Vector3(0, 1, 0)).y).toBeCloseTo(1, 6);
    }
    w.views.setRoad(source);
    w.draw(entity({ x: 0, y: 0, road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 } }));
    expect(w.bikeDirection(new Vector3(0, 1, 0)).y).toBeCloseTo(1, 6);
    w.views.setStructures(planOfBoxes([boxAt('roof', 20, -100, 0, 8, 10, { kind: 'flat', topM: 15 })]));
    w.draw(entity({ y: 15 }));
    expect(w.bikeDirection(new Vector3(0, 1, 0)).y).toBeCloseTo(1, 6);
  });

  it('lays the actual shadow matrix in the source plane and suppresses holes', () => {
    const w = world();
    w.views.setRoad(road());
    w.draw(entity());
    expect(w.shadows.count).toBe(1);
    const m = new Matrix4();
    w.shadows.getMatrixAt(0, m);
    expect(new Vector3(0, 0, 1).transformDirection(m).distanceTo(normal)).toBeLessThan(1e-5);
    expect(new Vector3().setFromMatrixPosition(m).y).toBeCloseTo(10.04, 4);
    w.draw(entity({ x: 60 }));
    expect(w.shadows.count).toBe(0);
  });

  it('puts chalk vertices in the source plane, retains road and roof priority, and clears stale terrain', () => {
    const a = new AirPays();
    a.setRoad(road());
    const draw = (x = 20, y = 10, z = -100) => {
      const s = snap(
        entity({
          mode: 'Airborne',
          grounded: false,
          touchdown: { x, y, z, heading: 0.7, inS: 0.5, crooked: false },
        }),
      );
      a.update(s, s, 1, 0);
      a.root.updateMatrixWorld(true);
    };
    draw();
    expect(a.mark.visible).toBe(true);
    const p = a.mark.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3().fromBufferAttribute(p, i).applyMatrix4(a.mark.matrixWorld);
      expect(v.y - (0.5 * v.x - 0.1 * (v.z + 100))).toBeCloseTo(0.05, 5);
    }
    draw(60);
    expect(a.mark.visible).toBe(false);
    draw(0, 0);
    expect(a.mark.visible).toBe(true);
    expect(new Vector3(0, 1, 0).applyQuaternion(a.mark.quaternion).y).toBeCloseTo(1, 6);
    a.setStructures(planOfBoxes([boxAt('roof', 20, -100, 0, 8, 10, { kind: 'flat', topM: 15 })]));
    draw(20, 15);
    expect(a.mark.position.y).toBeCloseTo(15.05, 5);
    expect(new Vector3(0, 1, 0).applyQuaternion(a.mark.quaternion).y).toBeCloseTo(1, 6);
    a.setStructures(null);
    for (const next of [null, road(false)]) {
      a.setRoad(next);
      draw();
      expect(new Vector3(0, 1, 0).applyQuaternion(a.mark.quaternion).y).toBeCloseTo(1, 6);
    }
    a.dispose();
  });
});
