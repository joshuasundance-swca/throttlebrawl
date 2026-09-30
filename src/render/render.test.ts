// render-1 unit tests (docs/milestones/M1.md, render-1 automated acceptance): the view pool matches
// the live entity count after spawns and despawns; a full M1 scene stays inside the draw-call and
// triangle budgets; the road is a flat number of draw calls; threats are never fogged out.
import {
  Fog,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Scene,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import budget from '../../tests/perf/budget.json';
import {
  createRoadNetwork,
  fixtureNetwork,
  type BakedNetwork,
  type BakedRoad,
  type RoadNetwork,
} from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { createFlatLook, MIN_THREAT_DRAW_M } from './look';
import { buildRoadScene, ELEVATED_M, laneSpans } from './road-mesh';
import { EntityViews, lerpPose, shapeFor } from './views';
import { interpolateEntity } from './index';

// ---- Snapshot builders -------------------------------------------------------------------

function entity(
  id: number,
  kind: EntitySnapshot['kind'],
  over: Partial<EntitySnapshot> = {},
): EntitySnapshot {
  return {
    id,
    kind,
    mode: 'Road',
    road: { edge: 0, s: id * 10, d: 0, h: 0, dir: 1, yaw: 0 },
    x: id * 3,
    y: 1.5,
    z: -id * 10,
    heading: 0,
    speed: 20,
    lean: 0,
    contentId: kind === 'vehicle' ? 'base:sedan' : kind === 'ped' ? 'base:tourist' : `base:e${id}`,
    name: `e${id}`,
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
    distanceToFinish: 1000,
    place: 1,
    finished: false,
    ...over,
  };
}

function snap(entities: EntitySnapshot[], tick = 1): SimSnapshot {
  return { tick, timeScale: 1, entities, race: { over: false, routeLength: 3500, finishOrder: [] } };
}

interface Mix {
  riders: number;
  cars: number;
  trucks: number;
  peds: number;
  pickups: number;
  firstId?: number;
}

function world(mix: Mix): EntitySnapshot[] {
  const out: EntitySnapshot[] = [];
  let id = mix.firstId ?? 0;
  for (let i = 0; i < mix.riders; i++) {
    out.push(
      entity(id++, 'rider', { slot: i === 0 ? 0 : -1, faction: i === mix.riders - 1 ? 'law' : 'rider' }),
    );
  }
  for (let i = 0; i < mix.cars; i++) out.push(entity(id++, 'vehicle'));
  for (let i = 0; i < mix.trucks; i++) out.push(entity(id++, 'vehicle', { contentId: 'base:box-truck' }));
  for (let i = 0; i < mix.peds; i++) out.push(entity(id++, 'ped'));
  for (let i = 0; i < mix.pickups; i++) out.push(entity(id++, 'pickup', { contentId: 'base:lead-pipe' }));
  return out;
}

/** What the renderer would submit with no frustum culling: an upper bound on draw calls. */
function drawLoad(root: Object3D): { drawCalls: number; triangles: number } {
  let drawCalls = 0;
  let triangles = 0;
  const visit = (o: Object3D) => {
    if (!o.visible) return;
    if (o instanceof Mesh) {
      const g = (o as Mesh<BufferGeometry>).geometry;
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      const n = o instanceof InstancedMesh ? o.count : 1;
      if (n > 0) {
        drawCalls++;
        triangles += tris * n;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  return { drawCalls, triangles };
}

/** Rider view groups currently in the scene, in insertion order. */
function riderGroups(views: EntityViews): Group[] {
  return views.root.children.filter(
    (c): c is Group => c instanceof Group && c.visible && c.children.length === 5,
  );
}

// ---- The real baked road, whatever the road lane names its files ------------------------

const networkFiles = import.meta.glob<BakedNetwork>('../../packs/base/regions/*/networks/*.json', {
  eager: true,
  import: 'default',
});
const roadFiles = import.meta.glob<BakedRoad>('../../packs/base/regions/*/roads/*.json', {
  eager: true,
  import: 'default',
});

function realNetworks(): RoadNetwork[] {
  const roads = Object.values(roadFiles);
  return Object.values(networkFiles)
    .filter((n) => n.roads.every((id) => roads.some((r) => r.id === id)))
    .map((network) =>
      createRoadNetwork({ network, roads: roads.filter((r) => network.roads.includes(r.id)) }),
    );
}

// ---- Tests -------------------------------------------------------------------------------

describe('the entity view pool', () => {
  it('matches the live entity count after spawns and despawns', () => {
    const views = new EntityViews(createFlatLook());
    const first = world({ riders: 6, cars: 12, trucks: 3, peds: 4, pickups: 1 });
    views.sync(null, snap(first), 1, 0);
    expect(views.liveCount()).toBe(first.length);
    expect(views.viewCounts()).toMatchObject({ riders: 6, vehicles: 15, peds: 4, pickups: 1 });
    expect(riderGroups(views)).toHaveLength(6);

    // Despawn a rival, four cars, a truck, three pedestrians and the pickup.
    const survivors = first.filter(
      (e) =>
        !(e.id === 3) &&
        !(e.kind === 'vehicle' && e.id % 3 === 0) &&
        !(e.kind === 'ped' && e.id % 4 !== 0) &&
        e.kind !== 'pickup',
    );
    views.sync(snap(first), snap(survivors, 2), 0.5, 0.1);
    expect(views.liveCount()).toBe(survivors.length);
    expect(riderGroups(views)).toHaveLength(5);
    expect(views.viewCounts().pickups).toBe(0);

    // Spawn new ids: pooled views are reused, so the pool does not grow past its high-water mark.
    const pooledBefore = views.viewCounts().pooled;
    const spawned = [
      ...survivors,
      ...world({ riders: 1, cars: 7, trucks: 1, peds: 2, pickups: 1, firstId: 500 }),
    ];
    views.sync(snap(survivors), snap(spawned, 3), 1, 0.2);
    expect(views.liveCount()).toBe(spawned.length);
    expect(riderGroups(views)).toHaveLength(6);
    expect(views.viewCounts().pooled).toBe(pooledBefore);

    // Everything gone.
    views.sync(snap(spawned), snap([], 4), 1, 0.3);
    expect(views.liveCount()).toBe(0);
    expect(riderGroups(views)).toHaveLength(0);
  });

  it('grows the instanced traffic past its first capacity', () => {
    const views = new EntityViews(createFlatLook());
    const crowd = world({ riders: 1, cars: 90, trucks: 20, peds: 40, pickups: 0 });
    views.sync(null, snap(crowd), 1, 0);
    expect(views.liveCount()).toBe(crowd.length);
    const counts = views.root.children
      .filter((c): c is InstancedMesh => c instanceof InstancedMesh)
      .map((m) => [m.name, m.count]);
    expect(Object.fromEntries(counts)).toEqual({ 'views-car': 90, 'views-truck': 20, 'views-ped': 40 });
  });

  it('draws trucks for big traffic types and cars otherwise', () => {
    const def = { contentId: 'x', lengthM: 4, widthM: 2, cruiseMps: 20 };
    expect(shapeFor({ ...def, category: 'truck', hazard: 'big' }, 'x')).toBe('truck');
    expect(shapeFor({ ...def, category: 'car', hazard: 'normal' }, 'x')).toBe('car');
    expect(shapeFor({ ...def, category: 'rv', hazard: 'normal' }, 'x')).toBe('truck');
    expect(shapeFor(undefined, 'base:semi-truck')).toBe('truck');
    expect(shapeFor(undefined, 'base:sedan')).toBe('car');
  });
});

describe('rider poses', () => {
  const setup = (me: Partial<EntitySnapshot>, targetX: number) => {
    const views = new EntityViews(createFlatLook());
    const rider = entity(0, 'rider', { x: 0, z: 0, heading: 0, targetId: 1, ...me });
    const target = entity(1, 'rider', { x: targetX, z: -1 });
    views.sync(null, snap([rider, target]), 1, 0.05);
    const group = riderGroups(views)[0];
    if (!group) throw new Error('no rider view');
    const [, left, right, kickLeg, lightBar] = group.children as [Mesh, Group, Group, Group, Mesh];
    return { views, group, left, right, kickLeg, lightBar };
  };

  it('swings the arm on the target side in the active phase', () => {
    const toRight = setup({ attackPhase: 'active' }, 1.2);
    expect(toRight.right.rotation.z).toBeCloseTo(1.45);
    expect(toRight.left.rotation.z).toBeCloseTo(0);
    const toLeft = setup({ attackPhase: 'active' }, -1.2);
    expect(toLeft.left.rotation.z).toBeCloseTo(-1.45);
  });

  it('leans with the snapshot and wobbles after a hit', () => {
    const { views, group } = setup({ lean: 0.3 }, 1);
    expect(group.rotation.z).toBeCloseTo(-0.3);
    views.pushEvents([{ tick: 2, type: 'hit', actor: 1, target: 0, data: {} }]);
    views.sync(null, snap([entity(0, 'rider', { lean: 0.3 }), entity(1, 'rider')]), 1, 0.06);
    expect(Math.abs(group.rotation.z + 0.3)).toBeGreaterThan(0.01);
  });

  it('shows a kick leg only while kicking', () => {
    const { views, kickLeg } = setup({ attackPhase: 'windup' }, 1);
    expect(kickLeg.visible).toBe(false);
    views.pushEvents([{ tick: 2, type: 'attackStart', actor: 0, data: { kind: 'kick' } }]);
    views.sync(
      null,
      snap([entity(0, 'rider', { attackPhase: 'active', targetId: 1 }), entity(1, 'rider', { x: 1 })]),
      1,
      0.1,
    );
    expect(kickLeg.visible).toBe(true);
    views.sync(null, snap([entity(0, 'rider', { attackPhase: 'idle' }), entity(1, 'rider')]), 1, 0.2);
    expect(kickLeg.visible).toBe(false);
  });

  it('glints a held weapon through the wind-up (the steal cue), and not otherwise', () => {
    const find = (g: Group, name: 'weapon' | 'glint'): Mesh | undefined => {
      let found: Mesh | undefined;
      g.traverse((o) => {
        if (
          o instanceof Mesh &&
          (name === 'glint' ? o.material instanceof MeshBasicMaterial : o.children.length === 1)
        ) {
          found ??= o;
        }
      });
      return found;
    };
    const windup = setup({ attackPhase: 'windup', heldWeapon: 'base:lead-pipe' }, 1);
    const glint = find(windup.group, 'glint');
    expect(glint?.visible).toBe(true);
    expect(find(windup.group, 'weapon')?.visible).toBe(true);
    const idle = setup({ attackPhase: 'idle', heldWeapon: 'base:lead-pipe' }, 1);
    expect(find(idle.group, 'glint')?.visible).toBe(false);
  });

  it('draws the parked bike where the snapshot says while the rider runs back, and hides it otherwise', () => {
    const views = new EntityViews(createFlatLook());
    const parked = () =>
      views.root.children.filter(
        (c): c is Mesh => c instanceof Mesh && c.name === 'views-parked-bike' && c.visible,
      );
    const bikeAt = { x: 12, y: 1.5, z: -40, heading: 0.3 };
    views.sync(null, snap([entity(0, 'rider', { mode: 'OnFoot', parkedBike: bikeAt })]), 1, 0);
    expect(parked()).toHaveLength(1);
    const bike = parked()[0];
    expect([bike?.position.x, bike?.position.y, bike?.position.z]).toEqual([12, 1.5, -40]);
    expect(bike?.rotation.y).toBeCloseTo(0.3);
    expect(drawLoad(views.root).triangles).toBeGreaterThan(0);
    // Back on the bike: no second bike. Gone with the rider too.
    views.sync(null, snap([entity(0, 'rider', { mode: 'Road', parkedBike: null })]), 1, 0.1);
    expect(parked()).toHaveLength(0);
    views.sync(null, snap([entity(0, 'rider', { mode: 'OnFoot', parkedBike: bikeAt })]), 1, 0.2);
    views.sync(null, snap([]), 1, 0.3);
    expect(parked()).toHaveLength(0);
  });

  it('puts a light bar on the law only', () => {
    expect(setup({ faction: 'law' }, 1).lightBar.visible).toBe(true);
    expect(setup({ faction: 'rider' }, 1).lightBar.visible).toBe(false);
  });

  it('lays a diving pedestrian down, from the event or from leaving the ground', () => {
    const views = new EntityViews(createFlatLook());
    const ped = entity(7, 'ped');
    views.sync(null, snap([ped]), 1, 0);
    const mesh = views.root.children.find((c): c is InstancedMesh => c.name === 'views-ped');
    if (!mesh) throw new Error('no ped mesh');
    const tilt = () => {
      const m = new Matrix4();
      mesh.getMatrixAt(0, m);
      return Math.abs(m.elements[1] ?? 0); // x axis picks up y when rolled
    };
    expect(tilt()).toBeCloseTo(0);
    views.sync(null, snap([entity(7, 'ped', { road: { ...ped.road, h: 0.4 } })]), 1, 0.1);
    expect(tilt()).toBeGreaterThan(0.9);
    views.pushEvents([{ tick: 3, type: 'pedDive', actor: 7, data: {} }]);
    views.sync(null, snap([ped]), 1, 0.7);
    expect(tilt()).toBeGreaterThan(0.9);
  });
});

describe('interpolation', () => {
  it('interpolates position and takes the short way round on heading', () => {
    const a = entity(0, 'rider', { x: 0, heading: Math.PI - 0.1 });
    const b = entity(0, 'rider', { x: 10, heading: -Math.PI + 0.1 });
    const p = lerpPose(a, b, 0.5, { x: 0, y: 0, z: 0, heading: 0, lean: 0 });
    expect(p.x).toBeCloseTo(5);
    expect(Math.abs(p.heading)).toBeCloseTo(Math.PI);
  });

  it('finds entities by id when the list is not indexed by id', () => {
    const prev = snap([entity(4, 'vehicle', { x: 0 }), entity(9, 'rider', { x: 0 })]);
    const curr = snap([entity(9, 'rider', { x: 8 })]);
    expect(interpolateEntity(prev, curr, 0.25, 9)?.x).toBeCloseTo(2);
    expect(interpolateEntity(prev, curr, 0.25, 4)).toBeNull();
  });
});

describe('the road meshes', () => {
  const look = createFlatLook();

  it('builds the real baked road with bridge rails, pylons and no NaN', () => {
    const nets = realNetworks();
    expect(nets.length).toBeGreaterThan(0);
    for (const road of nets) {
      const { group, stats } = buildRoadScene(road, look);
      expect(stats.triangles).toBeGreaterThan(1000);
      group.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        const pos = (o as Mesh<BufferGeometry>).geometry.getAttribute('position').array as Float32Array;
        expect(
          pos.every((v) => Number.isFinite(v)),
          o.name,
        ).toBe(true);
      });
      const elevated = road.edges.some((e) => Array.from(e.y).some((y) => y >= ELEVATED_M));
      if (elevated) {
        expect(stats.railM).toBeGreaterThan(0);
        expect(stats.pylons).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the draw calls flat however many edges there are', () => {
    const three = createRoadNetwork(
      fixtureNetwork([0, 1, 2].map((i) => ({ id: `r${i}`, lengthM: 200, kappa: 0.002 }))),
    );
    const nine = createRoadNetwork(
      fixtureNetwork([0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: `r${i}`, lengthM: 200, kappa: -0.002 }))),
    );
    const a = buildRoadScene(three, look).stats;
    const b = buildRoadScene(nine, look).stats;
    expect(b.meshes).toBe(a.meshes);
    expect(b.triangles).toBeGreaterThan(a.triangles * 2.5);
  });

  it('uses barriers and ramp features from the dressing', () => {
    const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 300, kappa: 0 }]));
    const bare = buildRoadScene(road, look).stats;
    expect(bare.railM).toBe(0); // sea level: nothing is high enough for the elevation rule
    const dressed = buildRoadScene(road, look, {
      flat: {
        barriers: [{ s0: 50, s1: 150, side: 'both', kind: 'rail', heightM: 1 }],
        features: [{ kind: 'ramp', s0: 200, s1: 210, d0: 0, d1: 3.4 }],
      },
    }).stats;
    expect(dressed.railM).toBe(200);
    expect(dressed.rampStripes).toBe(10);
  });

  it('finds lane spans and the centre line between opposite directions', () => {
    const spans = laneSpans([
      { id: 'L0', dCenterM: -4.15, widthM: 1.5, direction: -1, kind: 'shoulder' },
      { id: 'L1', dCenterM: -1.7, widthM: 3.4, direction: -1, kind: 'drive' },
      { id: 'R1', dCenterM: 1.7, widthM: 3.4, direction: 1, kind: 'drive' },
      { id: 'R2', dCenterM: 5.1, widthM: 3.4, direction: 1, kind: 'drive' },
    ]);
    expect(spans.drive).toEqual([-3.4, 6.8]);
    expect(spans.shortcut).toBeNull();
    expect(spans.dividers).toEqual([
      { d: 0, opposite: true },
      { d: 3.4, opposite: false },
    ]);
  });
});

describe('the M1 scene budget (no frustum culling, so an upper bound)', () => {
  it('stays inside the draw-call and triangle budgets with the whole M1 field on screen', () => {
    const look = createFlatLook();
    const scene = new Scene();
    const road = realNetworks()[0];
    if (!road) throw new Error('no baked network');
    scene.add(buildRoadScene(road, look).group);
    const views = new EntityViews(look);
    scene.add(views.root);
    // The player, 4 rivals and the cop, all swinging held weapons; heavy traffic both ways;
    // a crowd of pedestrians; two pickups.
    const field = world({ riders: 6, cars: 30, trucks: 8, peds: 16, pickups: 2 }).map((e) =>
      e.kind === 'rider' ? { ...e, attackPhase: 'windup' as const, heldWeapon: 'base:lead-pipe' } : e,
    );
    views.sync(null, snap(field), 1, 0);
    const load = drawLoad(scene);
    console.log(`[examined] M1 scene upper bound: ${load.drawCalls} draw calls, ${load.triangles} triangles`);
    expect(load.drawCalls).toBeLessThanOrEqual(budget.drawCallsMax);
    expect(load.triangles).toBeLessThanOrEqual(budget.trianglesMax);
  });
});

describe('the look', () => {
  it('never fogs out threats inside the minimum draw distance', () => {
    const scene = new Scene();
    createFlatLook().setupScene(scene, { timeOfDay: 'golden-hour' });
    expect(scene.fog).toBeInstanceOf(Fog);
    expect((scene.fog as Fog).near).toBeGreaterThanOrEqual(MIN_THREAT_DRAW_M);
    expect(MIN_THREAT_DRAW_M).toBe(200);
  });

  it('shares one material per kind and colour, and keeps light sources unlit', () => {
    const look = createFlatLook();
    expect(look.material('road')).toBe(look.material('road'));
    expect(look.material('rider', { color: '#ff0000' })).not.toBe(
      look.material('rider', { color: '#00ff00' }),
    );
    expect(look.material('lightbar')).toBeInstanceOf(MeshBasicMaterial);
    expect(look.material('glint')).toBeInstanceOf(MeshBasicMaterial);
  });
});
