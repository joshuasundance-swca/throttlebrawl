// W-P "fill the world": each region's own traffic and people draw as themselves (traffic-figures.ts),
// each figure is its own instanced mesh sized to its type, and a person who shakes a fist or films
// (`pedReact`) takes that pose for the hold and then stands as before.
import { Box3, InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimEvent, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { createFlatLook } from './look';
import {
  peopleFigureFor,
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
  road('region-sf:dawdle-robotaxi', 'car', 4.8, 1.9),
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
    expect(trafficFigureFor('base:beach-cruiser')).toBe('cyclist');
    expect(trafficFigureFor('region-pnw:rain-cape-cyclist')).toBe('cyclist');
    expect(trafficFigureFor('region-pnw:log-truck')).toBe('logTruck');
    expect(trafficFigureFor('region-pnw:wagon-with-kayaks')).toBe('wagon');
    expect(trafficFigureFor('region-pnw:mossy-wagon')).toBe('wagon');
    expect(trafficFigureFor('region-sf:dawdle-robotaxi')).toBe('robotaxi');
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
    expect(p('base:tourist-with-cooler', 'fist')).toBe('personFist');
    expect(p('base:sunburnt-jogger', 'film')).toBe('personPhone');
    // Animals never take a person's pose.
    expect(p('base:dive-bar-dog', 'fist')).toBe('dog');
    expect(peopleFigureFor(road('base:chicken', 'animal', 0.4, 0.3), 'base:chicken', null)).toBeNull();
  });

  it('gives every figure its own shape, and the paint comes from the figure', () => {
    const parts = Object.values(TRAFFIC_FIGURE_PARTS).map((x) => JSON.stringify(x));
    expect(new Set(parts).size).toBe(parts.length);
    for (const [k, x] of Object.entries(TRAFFIC_FIGURE_PARTS)) expect(x.length, k).toBeGreaterThanOrEqual(6);
    expect(trafficFigureTint('robotaxi', 'region-sf:dawdle-robotaxi', 3)).toBe('#f4f4f4');
    expect(trafficFigureTint('dog', 'region-pnw:wet-dog', 9)).toBe('#5a4636');
    expect(trafficFigureTint('personFist', 'base:sunburnt-jogger', 2)).toBe('#ff6b6b');
  });
});

describe('the entity views draw the regional traffic and people as themselves', () => {
  const vehicles = TYPES.filter((t) => !['pedestrian', 'animal'].includes(t.category)).map((t, i) =>
    entity(100 + i, 'vehicle', t.contentId),
  );
  const people = TYPES.filter((t) => ['pedestrian', 'animal'].includes(t.category)).map((t, i) =>
    entity(200 + i, 'ped', t.contentId),
  );
  const views = new EntityViews(createFlatLook());
  views.setTrafficTypes(TYPES);
  views.sync(null, snap([...vehicles, ...people]), 1, 0);
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
    expect(d).toMatchObject({
      'views-rv': 2,
      'views-cyclist': 2,
      'views-jogger': 2,
      'views-hiker': 1,
      'views-dogWalker': 1,
      'views-dog': 2,
      'views-ped': 1,
      'views-car': 1,
      'views-truck': 1,
    });
    expect(views.viewCounts().vehicles).toBe(vehicles.length);
    expect(views.viewCounts().peds).toBe(people.length);
  });

  it('sizes each to its type: a 16 m log truck, a narrow cyclist, a robotaxi taller than a convertible', () => {
    const log = sizeOf('views-logTruck');
    const cyclist = sizeOf('views-cyclist');
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
