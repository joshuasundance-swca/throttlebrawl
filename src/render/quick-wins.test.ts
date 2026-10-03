// Playtest 1b item 5 [decided]: the quick wins, speed-boost pads and a jumpable car-carrier ramp
// truck, drawn as placeholder geometry from the road's `boostPad` and `rampTruck` features (the
// road lane's contract: docs/content-packs.md). The checks look at the built meshes the way the
// camera and a rider meet them: rays straight down onto the pad and the truck's deck, and a ray
// from behind at the ramp.
import {
  Color,
  InstancedMesh,
  Mesh,
  Raycaster,
  Vector3,
  type BufferGeometry,
  type Group,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork, type RoadNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { createFlatLook } from './look';
import { buildRoadScene, type FeatureSpan } from './road-mesh';
import { EntityViews } from './views';

const look = createFlatLook();
const road: RoadNetwork = createRoadNetwork(fixtureNetwork([{ id: 'r', lengthM: 400, kappa: 0.002 }]));

function scene(features: FeatureSpan[]): Group {
  const { group } = buildRoadScene(road, look, { r: { features } }, { roadsideDensity: 0 });
  group.updateMatrixWorld(true);
  return group;
}

function meshes(group: Group): Object3D[] {
  const out: Object3D[] = [];
  group.traverse((o) => {
    if (o instanceof Mesh && !(o instanceof InstancedMesh) && o.name !== 'road-water') out.push(o);
  });
  return out;
}

/** The first thing a ray meets, with the colour of the face it hit (vertex colours, else the material). */
function firstHit(group: Group, from: Vector3, dir: Vector3) {
  const ray = new Raycaster(from, dir.clone().normalize(), 0, 200);
  const hit = ray.intersectObjects(meshes(group), false)[0];
  if (!hit) return null;
  const mesh = hit.object as Mesh<BufferGeometry>;
  const colors = mesh.geometry.getAttribute('color');
  const c = new Color();
  if (colors && hit.face) c.fromBufferAttribute(colors, hit.face.a);
  else c.copy((mesh.material as unknown as { color: Color }).color);
  return {
    name: mesh.name,
    y: hit.point.y,
    point: hit.point,
    luminance: 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
  };
}

const down = new Vector3(0, -1, 0);
const above = (s: number, d: number) => {
  const p = road.toWorld(0, s, d, 0);
  return new Vector3(p.x, p.y + 20, p.z);
};

describe('boost pads (playtest 1b, item 5)', () => {
  const pad: FeatureSpan = { kind: 'boostPad', s0: 100, s1: 106, d0: 0.4, d1: 3.0 };
  const group = scene([pad]);

  it('draws a bright pad over its box on the road, and nothing around it', () => {
    for (const [s, d] of [
      [101, 1],
      [103, 1.7],
      [105, 2.6],
    ] as const) {
      const hit = firstHit(group, above(s, d), down);
      expect(hit?.name, `s ${s} d ${d}`).toMatch(/road-boost(Pad|Mark)/);
      expect(hit!.y).toBeGreaterThan(road.toWorld(0, s, d, 0).y + 0.03); // above the lane markings
    }
    expect(firstHit(group, above(95, 1.7), down)?.name).not.toMatch(/boost/);
    expect(firstHit(group, above(103, -1.7), down)?.name).not.toMatch(/boost/);
    const fill = group.getObjectByName('road-boostPad') as Mesh;
    const c = (fill.material as unknown as { color: Color }).color;
    expect(Math.max(c.r, c.g, c.b)).toBeGreaterThan(0.8); // it glows, unlike the asphalt
  });

  it('points its chevrons the way riders travel', () => {
    expect(group.getObjectByName('road-boostMark')).toBeDefined();
  });
});

describe('the car-carrier ramp truck (playtest 1b, item 5)', () => {
  const truck: FeatureSpan = {
    kind: 'rampTruck',
    s0: 200,
    s1: 222,
    d0: 3.8,
    d1: 6.4,
    params: { lipHeightM: 2.8, rampLengthM: 11.5 },
  };
  const group = scene([truck]);
  const mid = (truck.d0 + truck.d1) / 2;

  it("puts its deck where the sim's deck is: up the ramp, then flat at the lip to the front", () => {
    const checks: string[] = [];
    for (const x of [1.5, 4, 7, 10]) {
      const hit = firstHit(group, above(truck.s0 + x, mid), down);
      const surface = road.toWorld(0, truck.s0 + x, mid, 0).y;
      const want = surface + (2.8 * x) / 11.5;
      checks.push(`ramp +${x} m: ${(hit!.y - surface).toFixed(2)} (want ${(want - surface).toFixed(2)})`);
      expect(hit!.y, `on the ramp, ${x} m up`).toBeCloseTo(want, 0);
      expect(Math.abs(hit!.y - want)).toBeLessThan(0.15);
    }
    for (const s of [truck.s0 + 13, truck.s0 + 17, truck.s1 - 0.6]) {
      const hit = firstHit(group, above(s, mid), down);
      const surface = road.toWorld(0, s, mid, 0).y;
      expect(Math.abs(hit!.y - (surface + 2.8)), `flat deck at s ${s}`).toBeLessThan(0.15);
    }
    console.log(`[examined] ramp deck heights: ${checks.join('; ')}`);
  });

  it('shows a light-coloured ramp to a rider coming up behind it', () => {
    const f = road.frameAt(0, truck.s0 - 20);
    const from = road.toWorld(0, truck.s0 - 20, mid, 1.2);
    const hit = firstHit(group, new Vector3(from.x, from.y, from.z), new Vector3(f.tx, 0, f.tz));
    expect(hit?.name).toBe('road-rampTrucks');
    expect(hit!.luminance).toBeGreaterThan(0.6);
  });

  it('stays inside its own width, off the traffic lanes', () => {
    for (const d of [truck.d0 - 0.5, -1.7]) {
      expect(firstHit(group, above(210, d), down)?.name, `d ${d}`).not.toBe('road-rampTrucks');
    }
  });

  it('uses the default lip and ramp length when the feature leaves them out', () => {
    const plain = scene([{ kind: 'rampTruck', s0: 200, s1: 222, d0: 3.8, d1: 6.4 }]);
    const hit = firstHit(plain, above(200 + 11.5 / 2, mid), down);
    const surface = road.toWorld(0, 200 + 11.5 / 2, mid, 0).y;
    expect(Math.abs(hit!.y - (surface + 1.4))).toBeLessThan(0.15);
  });

  it('has no roadside palm growing through it', () => {
    // A truck parked well off the road, where palms would otherwise stand, at a high palm density.
    const far: FeatureSpan = { kind: 'rampTruck', s0: 100, s1: 300, d0: 7, d1: 12.5 };
    // The palms as placed: each draws merged into its block, where its spot is (run W-S).
    const spots = buildRoadScene(road, look, { r: { features: [far] } }, { roadsideDensity: 3 })
      .spots.filter((s) => s.kind === 'palm')
      .map((s) => new Vector3(s.p.x, s.p.y, s.p.z));
    let inside = 0;
    for (const p of spots) {
      for (let s = 100; s <= 300; s += 1) {
        const c = road.toWorld(0, s, 9.75, 0);
        if (Math.hypot(p.x - c.x, p.z - c.z) < 2.75) inside++;
      }
    }
    expect(spots.length).toBeGreaterThan(10); // the other side still has its palms
    expect(inside).toBe(0);
  });
});

describe('the boost flame (playtest 1b, item 5)', () => {
  function rider(over: Partial<EntitySnapshot> & { boostS?: number }): EntitySnapshot {
    return {
      id: 0,
      kind: 'rider',
      mode: 'Road',
      road: { edge: 0, s: 10, d: 0, h: 0, dir: 1, yaw: 0 },
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
      speed: 40,
      lean: 0,
      contentId: 'base:you',
      name: 'you',
      faction: 'rider',
      slot: 0,
      throttle: 1,
      rpm: 8000,
      gear: 5,
      grounded: true,
      health: 100,
      healthMax: 100,
      attackPhase: 'idle',
      heldWeapon: null,
      targetId: -1,
      lastAttackerId: -1,
      progress: 0,
      distanceToFinish: 1000,
      place: 1,
      finished: false,
      ...over,
    };
  }
  const snap = (e: EntitySnapshot): SimSnapshot => ({
    tick: 1,
    timeScale: 1,
    entities: [e],
    race: { over: false, routeLength: 1000, finishOrder: [] },
  });
  const flame = (views: EntityViews) => views.root.getObjectByName('views-boost-flame');

  it('burns behind a boosting rider and goes out when the boost ends or the rider comes off', () => {
    const views = new EntityViews(look);
    views.sync(null, snap(rider({ boostS: 1.2 })), 1, 0);
    expect(flame(views)?.visible).toBe(true);
    views.sync(null, snap(rider({ boostS: 0 })), 1, 0.1);
    expect(flame(views)?.visible).toBe(false);
    views.sync(null, snap(rider({})), 1, 0.2);
    expect(flame(views)?.visible).toBe(false);
    views.sync(null, snap(rider({ boostS: 1, mode: 'Tumble' })), 1, 0.3);
    expect(flame(views)?.visible).toBe(false);
  });
});
