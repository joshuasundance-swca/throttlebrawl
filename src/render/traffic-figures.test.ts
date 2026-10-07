// W-P "fill the world": each region's own traffic and people draw as themselves (traffic-figures.ts),
// each figure is its own instanced mesh sized to its type, and a person who shakes a fist or films
// (`pedReact`) takes that pose for the hold and then stands as before.
import {
  Box3,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { mergeBoxes } from './geometry';
import { createFlatLook } from './look';
import {
  ANIMAL_HEIGHT_M,
  PEOPLE_FIGURES,
  peopleFigureFor,
  TRAFFIC_FIGURE_HEIGHT_M,
  TRAFFIC_FIGURE_PARTS,
  TRAFFIC_FIGURES,
  trafficFigureFor,
  trafficFigureTint,
} from './traffic-figures';
import { EntityViews } from './views';

function entity(id: number, kind: EntitySnapshot['kind'], contentId: string): EntitySnapshot {
  return {
    id,
    kind,
    mode: 'Road',
    road: { edge: 0, s: id * 10, d: 0, h: 0, dir: 1, yaw: 0 },
    x: id * 3,
    y: 0,
    z: -id * 10,
    heading: 0,
    speed: 0,
    lean: 0,
    contentId,
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
  };
}
const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});
const road = (
  contentId: string,
  category: SimTrafficTypeDef['category'],
  lengthM: number,
  widthM: number,
): SimTrafficTypeDef => ({ contentId, category, lengthM, widthM, cruiseMps: 10, hazard: 'normal' });

/** The W-P types as each pack's traffic folder defines them, plus a few older ones. */
const TYPES: SimTrafficTypeDef[] = [
  road('base:golf-cart', 'car', 2.4, 1.3),
  road('base:rental-convertible', 'car', 4.6, 1.8),
  road('base:pickup-towing-boat', 'truck', 7.5, 2.2),
  road('base:snowbird-rv', 'rv', 7.5, 2.4),
  road('base:beach-cruiser', 'car', 1.8, 0.6),
  road('region-pnw:log-truck', 'truck', 16, 2.6),
  road('region-pnw:wagon-with-kayaks', 'car', 4.8, 1.8),
  road('region-pnw:motorhome', 'rv', 9.5, 2.5),
  road('region-pnw:rain-cape-cyclist', 'car', 1.8, 0.6),
  road('region-sf:hesitron-robotaxi', 'car', 4.8, 1.9),
  road('region-sf:startup-shuttle', 'rv', 11, 2.6),
  road('region-sf:delivery-e-bike', 'car', 1.8, 0.7),
  road('region-sf:e-scooter-rider', 'car', 1.1, 0.55),
  road('base:sunburnt-jogger', 'pedestrian', 0.5, 0.5),
  road('region-pnw:trail-runner', 'pedestrian', 0.5, 0.5),
  road('region-pnw:rain-shell-hiker', 'pedestrian', 0.5, 0.6),
  road('region-sf:dog-walker-sf', 'pedestrian', 0.5, 0.7),
  road('base:dive-bar-dog', 'animal', 0.9, 0.35),
  road('region-sf:doodle', 'animal', 0.9, 0.4),
  road('base:tourist-with-cooler', 'pedestrian', 0.5, 0.6),
  road('base:sedan-rental', 'car', 4.6, 1.8),
  road('base:box-truck', 'truck', 7.5, 2.4),
  // Playtest 3 (T4.3): the moving ramp truck, the real-world local life and the big animals.
  road('base:event-car-carrier', 'truck', 7.5, 2.4),
  road('base:pedicab', 'car', 2.6, 1.2),
  road('base:island-tram', 'truck', 14, 2.2),
  road('region-pnw:pdx-streetcar', 'truck', 20, 2.5),
  road('region-pnw:elk', 'animal', 2.4, 0.9),
  road('region-pnw:raccoon', 'animal', 0.6, 0.3),
  road('region-sf:sea-lion', 'animal', 2.0, 0.8),
  road('base:rooster', 'animal', 0.45, 0.3),
  // Playtest 4 (P4-16): the party street's people.
  road('base:bar-hopper', 'pedestrian', 0.5, 0.6),
  road('base:birthday-party', 'pedestrian', 0.5, 0.6),
  road('region-sf:parrot-flock', 'animal', 2, 2),
];
const def = (id: string) => TYPES.find((t) => t.contentId === id);

describe('which regional figure draws each type', () => {
  it("maps each region's traffic by id, and leaves the older shapes alone", () => {
    expect(trafficFigureFor('base:golf-cart')).toBe('golfCart');
    expect(trafficFigureFor('base:rental-convertible')).toBe('convertible');
    expect(trafficFigureFor('base:pickup-towing-boat')).toBe('boatPickup');
    expect(trafficFigureFor('base:snowbird-rv')).toBe('rv');
    expect(trafficFigureFor('region-pnw:motorhome')).toBe('rv');
    expect(trafficFigureFor('region-pnw:camper-van')).toBe('rv');
    expect(trafficFigureFor('base:beach-cruiser')).toBe('cruiser');
    expect(trafficFigureFor('region-pnw:rain-cape-cyclist')).toBe('rainCyclist');
    expect(trafficFigureFor('region-pnw:log-truck')).toBe('logTruck');
    expect(trafficFigureFor('region-pnw:wagon-with-kayaks')).toBe('wagon');
    expect(trafficFigureFor('region-pnw:mossy-wagon')).toBe('wagon');
    expect(trafficFigureFor('region-sf:hesitron-robotaxi')).toBe('robotaxi');
    expect(trafficFigureFor('region-sf:startup-shuttle')).toBe('shuttle');
    expect(trafficFigureFor('region-sf:delivery-e-bike')).toBe('eBike');
    expect(trafficFigureFor('region-sf:e-scooter-rider')).toBe('scooterRider');
    for (const old of ['base:sedan-rental', 'base:pickup', 'base:box-truck', 'region-sf:cable-car'])
      expect(trafficFigureFor(old), old).toBeNull();
    expect(trafficFigureFor('region-sf:rideshare-hatchback')).toBeNull();
  });

  it('maps people and dogs, and a reacting person to the fist or phone pose', () => {
    const p = (id: string, g: 'fist' | 'film' | null = null) => peopleFigureFor(def(id), id, g);
    expect(p('base:sunburnt-jogger')).toBe('jogger');
    expect(p('region-pnw:trail-runner')).toBe('jogger');
    expect(p('region-pnw:rain-shell-hiker')).toBe('hiker');
    expect(p('region-sf:dog-walker-sf')).toBe('dogWalker');
    expect(p('base:dive-bar-dog')).toBe('dog');
    expect(p('region-sf:doodle')).toBe('dog');
    expect(p('base:tourist-with-cooler')).toBeNull();
    // The party street's revellers have a figure of their own; the door greeter is an ordinary person.
    expect(p('base:bar-hopper')).toBe('reveller');
    expect(p('base:birthday-party')).toBe('reveller');
    expect(p('base:door-greeter')).toBeNull();
    expect(p('base:bar-hopper', 'film')).toBe('personPhone');
    expect(p('base:tourist-with-cooler', 'fist')).toBe('personFist');
    expect(p('base:sunburnt-jogger', 'film')).toBe('personPhone');
    // Animals never take a person's pose.
    expect(p('base:dive-bar-dog', 'fist')).toBe('dog');
    expect(peopleFigureFor(road('base:chicken', 'animal', 0.4, 0.3), 'base:chicken', null)).toBeNull();
  });

  it('gives every figure its own shape, and only dogs take a tint', () => {
    const parts = Object.values(TRAFFIC_FIGURE_PARTS).map((x) => JSON.stringify(x));
    expect(new Set(parts).size).toBe(parts.length);
    for (const [k, x] of Object.entries(TRAFFIC_FIGURE_PARTS)) expect(x.length, k).toBeGreaterThanOrEqual(6);
    // Only a dog is tinted (a tint multiplies every part, skin and kayaks too).
    expect(trafficFigureTint('robotaxi', 'region-sf:hesitron-robotaxi', 3)).toBe('#ffffff');
    expect(trafficFigureTint('dog', 'region-pnw:wet-dog', 9)).toBe('#5a4636');
    expect(trafficFigureTint('personFist', 'base:sunburnt-jogger', 2)).toBe('#ffffff');
  });
});

describe('the entity views draw the regional traffic and people as themselves', () => {
  const vehicles = [
    ...TYPES.filter((t) => !['pedestrian', 'animal'].includes(t.category)).map((t, i) =>
      entity(100 + i, 'vehicle', t.contentId),
    ),
    // A second car carrier, whose ramp has come down (`setPieceBeat` `rampDown`, T4.3).
    entity(190, 'vehicle', 'base:event-car-carrier'),
  ];
  const people = TYPES.filter((t) => ['pedestrian', 'animal'].includes(t.category)).map((t, i) =>
    entity(200 + i, 'ped', t.contentId),
  );
  const views = new EntityViews(createFlatLook());
  views.setTrafficTypes(TYPES);
  views.sync(null, snap([...vehicles, ...people]), 1, 0);
  views.pushEvents([{ tick: 1, type: 'setPieceBeat', actor: 190, data: { beat: 'rampDown' } }]);
  views.sync(null, snap([...vehicles, ...people]), 1, 0.05);
  const meshes = () =>
    new Map(
      views.root.children
        .filter((c): c is InstancedMesh => c instanceof InstancedMesh)
        .map((m) => [m.name, m]),
    );
  const drawn = () =>
    Object.fromEntries(
      [...meshes()].filter(([, m]) => m.count > 0 && m.visible).map(([n, m]) => [n, m.count]),
    );
  const sizeOf = (name: string) => {
    const mesh = meshes().get(name);
    if (!mesh) throw new Error(`no ${name}`);
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    mesh.geometry.computeBoundingBox();
    return (mesh.geometry.boundingBox ?? new Box3()).clone().applyMatrix4(m).getSize(new Vector3());
  };

  it('puts each figure in its own instanced mesh', () => {
    const d = drawn();
    console.log(`[examined] drawn instanced meshes: ${JSON.stringify(d)}`);
    for (const fig of TRAFFIC_FIGURES) expect(d[`views-${fig}`], fig).toBeGreaterThan(0);
    // The two reaction poses wait for a `pedReact` (below).
    for (const fig of PEOPLE_FIGURES.filter((f) => f !== 'personFist' && f !== 'personPhone'))
      expect(d[`views-${fig}`], fig).toBeGreaterThan(0);
    // One draw per figure kind in view, a carrier with its ramp up and one with it down apart.
    expect(d['views-carCarrier']).toBe(1);
    expect(d['views-carCarrierRamp']).toBe(1);
    expect(d).toMatchObject({
      'views-rv': 2,
      'views-cruiser': 1,
      'views-rainCyclist': 1,
      'views-jogger': 2,
      'views-hiker': 1,
      'views-dogWalker': 1,
      'views-dog': 2,
      'views-reveller': 2,
      'views-ped': 1,
      'views-car': 1,
      'views-truck': 1,
    });
    expect(views.viewCounts().vehicles).toBe(vehicles.length);
    expect(views.viewCounts().peds).toBe(people.length);
  });

  it('sizes each to its type: a 16 m log truck, a narrow cyclist, a robotaxi taller than a convertible', () => {
    const log = sizeOf('views-logTruck');
    const cyclist = sizeOf('views-cruiser');
    const taxi = sizeOf('views-robotaxi');
    const convertible = sizeOf('views-convertible');
    const dog = sizeOf('views-dog');
    const jogger = sizeOf('views-jogger');
    const f = (v: Vector3) =>
      v
        .toArray()
        .map((n) => n.toFixed(2))
        .join(' x ');
    console.log(
      `[examined] sizes (w x h x l): log truck ${f(log)}, cyclist ${f(cyclist)}, robotaxi ${f(taxi)}, convertible ${f(convertible)}, dog ${f(dog)}, jogger ${f(jogger)}`,
    );
    expect(log.z).toBeGreaterThan(15);
    expect(cyclist.x).toBeLessThan(0.8);
    expect(taxi.y).toBeGreaterThan(convertible.y);
    expect(dog.y).toBeLessThan(0.8);
    expect(jogger.y).toBeGreaterThan(1.4);
  });

  it('a person who shakes a fist takes the pose for the hold, then stands as before', () => {
    const tourist = people.find((e) => e.contentId === 'base:tourist-with-cooler');
    if (!tourist) throw new Error('no tourist');
    const fist: SimEvent = {
      tick: 1,
      type: 'pedReact',
      actor: tourist.id,
      target: 0,
      data: { kind: 'fist', ticks: 120 },
    };
    views.pushEvents([fist]);
    views.sync(null, snap([...vehicles, ...people]), 1, 0.5);
    expect(drawn()['views-personFist']).toBe(1);
    expect(drawn()['views-ped']).toBeUndefined();
    views.sync(null, snap([...vehicles, ...people]), 1, 3);
    expect(drawn()['views-personFist']).toBeUndefined();
    expect(drawn()['views-ped']).toBe(1);
    // A phone, then a dive, which drops the pose at once.
    views.pushEvents([{ ...fist, data: { kind: 'film', ticks: 120 } }]);
    views.sync(null, snap([...vehicles, ...people]), 1, 3.2);
    expect(drawn()['views-personPhone']).toBe(1);
    views.pushEvents([{ tick: 2, type: 'pedDive', actor: tourist.id, target: 0, data: { side: 1 } }]);
    views.sync(null, snap([...vehicles, ...people]), 1, 3.3);
    expect(drawn()['views-personPhone']).toBeUndefined();
  });
});

describe('the new presets and the big animals (playtest 3, T4.3)', () => {
  it('maps the local-life vehicles and the animals that used to draw as the chicken', () => {
    expect(trafficFigureFor('base:pedicab')).toBe('pedicab');
    expect(trafficFigureFor('base:island-tram')).toBe('roadTrain');
    expect(trafficFigureFor('region-pnw:pdx-streetcar')).toBe('streetcar');
    expect(trafficFigureFor('region-pnw:cargo-bike')).toBe('cruiser');
    expect(trafficFigureFor('base:event-car-carrier')).toBe('carCarrier');
    expect(trafficFigureFor('region-sf:event-car-carrier')).toBe('carCarrier');
    // Neighbours stay as they were: the tow truck and the cruise-ship day tripper are not these.
    expect(trafficFigureFor('base:event-tow-truck')).toBeNull();
    expect(trafficFigureFor('base:cruise-day-tripper')).toBeNull();
    const a = (id: string) => peopleFigureFor(road(id, 'animal', 1, 1), id, null) ?? 'none';
    expect(a('region-pnw:elk')).toBe('elk');
    expect(a('region-pnw:raccoon')).toBe('raccoon');
    expect(a('region-sf:sea-lion')).toBe('seaLion');
    expect(a('base:rooster')).toBe('rooster');
    expect(a('region-sf:parrot-flock')).toBe('parrotFlock');
    // The chicken keeps figures.ts's plain critter, and dogs stay dogs.
    expect(a('base:chicken')).toBe('none');
    expect(a('base:dive-bar-dog')).toBe('dog');
    // Without a catalog entry the id still decides.
    expect(peopleFigureFor(undefined, 'region-pnw:elk', null)).toBe('elk');
    expect(peopleFigureFor(undefined, 'region-pnw:pod-diner', null)).toBe('hiker');
  });

  it('builds every figure well under 600 triangles, each with its own shape', () => {
    const tris = Object.entries(TRAFFIC_FIGURE_PARTS).map(([k, parts]) => {
      const g = mergeBoxes(parts);
      return [k, (g.index?.count ?? 0) / 3] as const;
    });
    console.log(`[examined] triangles per figure: ${JSON.stringify(Object.fromEntries(tris))}`);
    for (const [k, n] of tris) expect(n, k).toBeLessThan(600);
    for (const k of ['pedicab', 'roadTrain', 'streetcar', 'carCarrier', 'carCarrierRamp'] as const)
      expect(TRAFFIC_FIGURE_PARTS[k].length, k).toBeGreaterThanOrEqual(8);
    for (const k of ['elk', 'raccoon', 'seaLion', 'rooster', 'parrotFlock'] as const)
      expect(ANIMAL_HEIGHT_M[k], k).toBeGreaterThan(0);
  });

  it('draws an elk as tall as an elk, a raccoon low, and no animal as the old critter', () => {
    const views = new EntityViews(createFlatLook());
    views.setTrafficTypes(TYPES);
    const ids = ['region-pnw:elk', 'region-pnw:raccoon', 'region-sf:sea-lion', 'base:rooster'];
    views.sync(null, snap(ids.map((id, i) => ({ ...entity(10 + i, 'ped', id), x: i * 5, z: 0 }))), 1, 0);
    const mesh = (n: string) => {
      const m = views.root.children.find(
        (c): c is InstancedMesh => c instanceof InstancedMesh && c.name === n,
      );
      if (!m) throw new Error(`no ${n}`);
      return m;
    };
    const size = (n: string) => {
      const m = mesh(n);
      const mat = new Matrix4();
      m.getMatrixAt(0, mat);
      m.geometry.computeBoundingBox();
      return (m.geometry.boundingBox ?? new Box3()).clone().applyMatrix4(mat).getSize(new Vector3());
    };
    const elk = size('views-elk');
    const raccoon = size('views-raccoon');
    const lion = size('views-seaLion');
    const f = (v: Vector3) =>
      v
        .toArray()
        .map((n) => n.toFixed(2))
        .join(' x ');
    console.log(`[examined] elk ${f(elk)}, raccoon ${f(raccoon)}, sea lion ${f(lion)}`);
    expect(elk.y).toBeGreaterThan(2);
    expect(elk.z).toBeGreaterThan(2);
    expect(raccoon.y).toBeLessThan(0.5);
    expect(lion.y).toBeLessThan(1);
    expect(lion.z).toBeGreaterThan(1.8);
    const critter = views.root.children.find((c) => c.name === 'views-critter') as InstancedMesh | undefined;
    expect(critter?.count ?? 0).toBe(0);
  });
});

describe('the car carrier draws its ramp (the moving ramp truck, T4.3)', () => {
  // The sim's numbers (src/sim/modifiers/moving.ts MOVING.rampRunM and rampSlope; render never
  // imports them): a 7.5 m by 2.4 m carrier, its rear the ramp's foot, a 5 m ramp rising 2.4 m,
  // then 2.5 m of body.
  const LENGTH_M = 7.5;
  const WIDTH_M = 2.4;
  const RUN_M = 5;
  const LIP_M = 2.4;
  const REAR = LENGTH_M / 2;
  const rampAt = (fromRear: number) => LIP_M * (fromRear / RUN_M);

  /** The height of the figure's top surface where a ray from above meets it (+z is the rear). */
  function surface(fig: 'carCarrier' | 'carCarrierRamp') {
    const g = mergeBoxes(TRAFFIC_FIGURE_PARTS[fig]).clone();
    g.scale(WIDTH_M, TRAFFIC_FIGURE_HEIGHT_M[fig], LENGTH_M);
    const mesh = new Mesh(g, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.updateMatrixWorld(true);
    const ray = new Raycaster();
    return (x: number, fromRear: number): number => {
      ray.set(new Vector3(x, 10, REAR - fromRear), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      return hit ? hit.point.y : 0;
    };
  }

  it('lowered, the ramp runs from the road at the rear to the sim lip, then the body', () => {
    const top = surface('carCarrierRamp');
    const samples = [0.3, 1.5, 2.5, 3.5, 4.7].map((d) => ({ d, want: rampAt(d), got: top(0, d) }));
    console.log(`[examined] lowered ramp surface (m from the rear: sim, drawn): ${JSON.stringify(samples)}`);
    const profile = (fig: 'carCarrier' | 'carCarrierRamp') => {
      const t = surface(fig);
      return Array.from({ length: 15 }, (_, k) => t(0, k * 0.5).toFixed(1)).join(' ');
    };
    console.log(`[examined] top profile every 0.5 m from the rear, ramp up: ${profile('carCarrier')}`);
    console.log(`[examined] top profile every 0.5 m from the rear, ramp down: ${profile('carCarrierRamp')}`);
    for (const s of samples) expect(Math.abs(s.got - s.want), `${s.d} m from the rear`).toBeLessThan(0.15);
    // One slope, never a step: it climbs most of the lip over its first 4.4 m.
    expect(samples[4]!.got - samples[0]!.got).toBeGreaterThan(0.9);
    // Past the lip the body stands higher than the lip: a rider who does not clear it meets a wall.
    expect(top(0, RUN_M + 1.5)).toBeCloseTo(LIP_M, 1);
    expect(top(0, LENGTH_M - 0.8)).toBeCloseTo(2.56, 1);
  });

  it('with the ramp up, the bed is level at the lip and the tailgate stands at the rear', () => {
    const top = surface('carCarrier');
    for (const d of [1.5, 2.5, 3.5]) expect(Math.abs(top(0, d) - 1.2), `${d} m`).toBeLessThan(0.15);
    expect(top(0, 0.1)).toBeGreaterThan(1.5);
    expect(top(0, LENGTH_M - 0.8)).toBeCloseTo(2.56, 1);
  });

  it('keeps both inside the carrier box, and the lowered ramp wears warning stripes', () => {
    for (const fig of ['carCarrier', 'carCarrierRamp'] as const) {
      const g = mergeBoxes(TRAFFIC_FIGURE_PARTS[fig]);
      g.computeBoundingBox();
      const b = g.boundingBox ?? new Box3();
      expect(b.min.z, fig).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.z, fig).toBeLessThanOrEqual(0.5 + 1e-6);
      expect(b.min.x, fig).toBeGreaterThanOrEqual(-0.5 - 1e-6);
      expect(b.max.x, fig).toBeLessThanOrEqual(0.5 + 1e-6);
    }
    const stripes = (fig: 'carCarrier' | 'carCarrierRamp') =>
      TRAFFIC_FIGURE_PARTS[fig].filter((p) => p.color === '#f2c14e' && p.size[2] < 0.1).length;
    expect(stripes('carCarrierRamp')).toBeGreaterThanOrEqual(4);
  });

  const drop = (actor: number): SimEvent => ({
    tick: 1,
    type: 'setPieceBeat',
    actor,
    data: { beat: 'rampDown', piece: 'moving-ramp', id: 'base:keys-moving-ramp' },
  });
  const counts = (views: EntityViews) =>
    Object.fromEntries(
      views.root.children
        .filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.visible && c.count > 0)
        .map((m) => [m.name, m.count]),
    );
  function carriers(ids: number[]) {
    const views = new EntityViews(createFlatLook());
    views.setTrafficTypes(TYPES);
    const entities = ids.map((id) => ({ ...entity(id, 'vehicle', 'base:event-car-carrier'), z: -id * 4 }));
    views.sync(null, snap(entities), 1, 0);
    return { views, entities };
  }

  it('draws the stowed carrier until its own rampDown beat, then only that one lowered', () => {
    const { views, entities } = carriers([40, 41]);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 2 });
    views.pushEvents([drop(41)]);
    views.sync(null, snap(entities), 1, 0.1);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 1, 'views-carCarrierRamp': 1 });
    // A later frame keeps it down (the beat fires once).
    views.sync(null, snap(entities), 1, 5);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 1, 'views-carCarrierRamp': 1 });
    // The carrier leaves, and ten seconds of frames later another takes its id: ramp up again.
    for (let f = 0; f < 700; f++) views.sync(null, snap([entities[0]!]), 1, 6 + f / 60);
    views.sync(null, snap([entities[0]!, entities[1]!]), 1, 20);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 2 });
    expect(counts(views)['views-carCarrierRamp']).toBeUndefined();
  });

  it('a new race (a new traffic catalog) forgets every lowered ramp', () => {
    const { views, entities } = carriers([60]);
    views.pushEvents([drop(60)]);
    views.sync(null, snap(entities), 1, 0.1);
    expect(counts(views)).toMatchObject({ 'views-carCarrierRamp': 1 });
    views.setTrafficTypes(TYPES);
    views.sync(null, snap(entities), 1, 0.2);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 1 });
    expect(counts(views)['views-carCarrierRamp']).toBeUndefined();
  });

  it('a beat that is not the ramp, or is for another vehicle, changes nothing', () => {
    const { views, entities } = carriers([50]);
    views.pushEvents([{ tick: 1, type: 'setPieceBeat', actor: 50, data: { beat: 'unhitch' } }, drop(999)]);
    views.sync(null, snap(entities), 1, 0.1);
    expect(counts(views)).toMatchObject({ 'views-carCarrier': 1 });
    expect(counts(views)['views-carCarrierRamp']).toBeUndefined();
  });
});

describe('a clipped cyclist topples onto the sidewalk (kerb riders, T4.3)', () => {
  const wobble = (rider: number, cyclist: number, data: Record<string, unknown>): SimEvent => ({
    tick: 5,
    type: 'wobble',
    actor: rider,
    target: cyclist,
    data: { cause: 'traffic', contact: 'wobble', hit: 'side', kerb: true, ...data },
  });

  const rightOf = (h: number) => new Vector3(Math.cos(h), 0, -Math.sin(h));

  /**
   * A cyclist (id 300) and a rider (id 1) abreast of it, a metre and a bit off to one side of it:
   * `riderSide` -1 is the cyclist's left, 1 its right. Both head `heading`.
   */
  function scene(riderSide: -1 | 1, heading = 0) {
    const views = new EntityViews(createFlatLook());
    views.setTrafficTypes(TYPES);
    const right = rightOf(heading);
    const cyclist = { ...entity(300, 'vehicle', 'base:beach-cruiser'), x: 10, z: -20, heading };
    const rider = {
      ...entity(1, 'rider', 'base:rider'),
      x: 10 + right.x * riderSide * 1.2,
      z: -20 + right.z * riderSide * 1.2,
      heading,
    };
    const entities = [rider, cyclist];
    views.sync(null, snap(entities), 1, 0);
    const mesh = views.root.children.find(
      (c): c is InstancedMesh => c instanceof InstancedMesh && c.name === 'views-cruiser',
    );
    if (!mesh) throw new Error('no cruiser mesh');
    /** The cyclist's up axis in the world, after the frame at time t. */
    const upAt = (t: number) => {
      views.sync(null, snap(entities), 1, t);
      const m = new Matrix4();
      mesh.getMatrixAt(0, m);
      const q = new Quaternion();
      m.decompose(new Vector3(), q, new Vector3());
      return new Vector3(0, 1, 0).applyQuaternion(q);
    };
    return { views, upAt };
  }
  const tilt = (up: Vector3) => Math.acos(Math.min(1, Math.max(-1, up.y)));

  it('tips about 70 degrees away from the rider for the topple, then stands up again', () => {
    for (const [riderSide, heading] of [
      [-1, 0],
      [1, 0],
      [-1, 0.8],
      [1, -1.1],
    ] as const) {
      const { views, upAt } = scene(riderSide, heading);
      views.pushEvents([wobble(1, 300, { toppleS: 2 })]);
      const away = -riderSide;
      const early = upAt(0.08);
      const lying = upAt(1.0);
      const late = upAt(1.9);
      const after = upAt(2.6);
      const label = `rider on the ${riderSide < 0 ? 'left' : 'right'}, heading ${heading}`;
      console.log(
        `[examined] ${label}: tilt ${tilt(early).toFixed(2)} (0.08 s), ${tilt(lying).toFixed(2)} (1 s), ${tilt(late).toFixed(2)} (1.9 s), ${tilt(after).toFixed(2)} (2.6 s)`,
      );
      expect(tilt(early), label).toBeGreaterThan(0.05);
      expect(tilt(early), label).toBeLessThan(tilt(lying));
      expect(tilt(lying), label).toBeCloseTo((70 * Math.PI) / 180, 1);
      // Away from the rider, across the road: along the cyclist's own right or left.
      expect(lying.dot(rightOf(heading)) * away, label).toBeGreaterThan(0.9);
      expect(tilt(late), label).toBeLessThan(tilt(lying));
      expect(tilt(after), label).toBeLessThan(0.02);
    }
  });

  it('a nudge with no topple (kerb but no toppleS), another vehicle, or no kerb flag tips nobody', () => {
    const { views, upAt } = scene(-1);
    views.pushEvents([wobble(1, 300, {}), wobble(1, 999, { toppleS: 2 })]);
    expect(tilt(upAt(1.0))).toBeLessThan(0.02);
    views.pushEvents([wobble(1, 300, { kerb: false, toppleS: 2 })]);
    expect(tilt(upAt(1.5))).toBeLessThan(0.02);
  });
});
