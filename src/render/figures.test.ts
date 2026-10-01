// Traffic-4's animals and oddities as their own shapes (render follow-up 5 in the traffic4-hs
// report). Before: every animal drew as the pedestrian figure, the mobile home and the parked boat
// as the truck box. The sim snapshot now names a pedestrian's or an animal's type (#197), so each
// draws as itself: these check the mapping from the real content ids, that each figure is its own
// instanced mesh with its own geometry, and that each is sized to its type.
import { Box3, InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { FIGURE_PARTS, oddityFigureFor, pedFigureFor } from './figures';
import { createFlatLook } from './look';
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

/** The traffic types as the base pack defines them (packs/base/traffic). */
const TYPES: SimTrafficTypeDef[] = [
  {
    contentId: 'base:iguana',
    category: 'animal',
    lengthM: 0.9,
    widthM: 0.3,
    cruiseMps: 1.2,
    hazard: 'normal',
  },
  {
    contentId: 'base:pelican',
    category: 'animal',
    lengthM: 0.7,
    widthM: 0.6,
    cruiseMps: 1,
    hazard: 'normal',
  },
  { contentId: 'base:gator', category: 'animal', lengthM: 2.4, widthM: 0.6, cruiseMps: 1, hazard: 'big' },
  {
    contentId: 'base:gator-on-lawn-chair',
    category: 'animal',
    lengthM: 1.4,
    widthM: 0.8,
    cruiseMps: 0,
    hazard: 'big',
  },
  {
    contentId: 'base:chicken',
    category: 'animal',
    lengthM: 0.4,
    widthM: 0.3,
    cruiseMps: 2.2,
    hazard: 'normal',
  },
  {
    contentId: 'base:fisherman',
    category: 'pedestrian',
    lengthM: 0.5,
    widthM: 0.5,
    cruiseMps: 1.4,
    hazard: 'normal',
  },
  {
    contentId: 'base:runaway-mobile-home',
    category: 'oddity',
    lengthM: 7.5,
    widthM: 2.4,
    cruiseMps: 9,
    hazard: 'big',
  },
  { contentId: 'base:parked-boat', category: 'oddity', lengthM: 7, widthM: 2.4, cruiseMps: 0, hazard: 'big' },
  { contentId: 'base:box-truck', category: 'truck', lengthM: 7.5, widthM: 2.4, cruiseMps: 20, hazard: 'big' },
];
const def = (id: string) => TYPES.find((t) => t.contentId === id);

describe('which figure draws each type', () => {
  it('maps the traffic-4 animals and oddities by id, other animals to the plain critter', () => {
    expect(pedFigureFor(def('base:iguana'), 'base:iguana')).toBe('iguana');
    expect(pedFigureFor(def('base:pelican'), 'base:pelican')).toBe('pelican');
    expect(pedFigureFor(def('base:gator'), 'base:gator')).toBe('gator');
    expect(pedFigureFor(def('base:gator-on-lawn-chair'), 'base:gator-on-lawn-chair')).toBe('lawnGator');
    expect(pedFigureFor(def('base:chicken'), 'base:chicken')).toBe('critter');
    expect(pedFigureFor({ ...def('base:chicken')!, contentId: 'region-pnw:elk' }, 'region-pnw:elk')).toBe(
      'critter',
    );
    expect(pedFigureFor(def('base:fisherman'), 'base:fisherman')).toBe('person');
    expect(pedFigureFor(undefined, '')).toBe('person');
    expect(oddityFigureFor('base:runaway-mobile-home')).toBe('mobileHome');
    expect(oddityFigureFor('base:parked-boat')).toBe('boatTrailer');
    expect(oddityFigureFor('base:box-truck')).toBeNull();
    expect(oddityFigureFor('region-pnw:espresso-stand-in-tow')).toBeNull();
  });

  it('gives every figure its own shape', () => {
    const shapes = Object.entries(FIGURE_PARTS).map(([k, parts]) => `${k}:${JSON.stringify(parts)}`);
    expect(new Set(Object.values(FIGURE_PARTS).map((p) => JSON.stringify(p))).size).toBe(shapes.length);
    for (const parts of Object.values(FIGURE_PARTS)) expect(parts.length).toBeGreaterThanOrEqual(8);
  });
});

describe('the entity views draw each animal and oddity as itself', () => {
  const views = new EntityViews(createFlatLook());
  views.setTrafficTypes(TYPES);
  const ids = [
    'base:iguana',
    'base:pelican',
    'base:gator',
    'base:gator-on-lawn-chair',
    'base:chicken',
    'base:fisherman',
  ];
  const peds = ids.map((c, i) => entity(10 + i, 'ped', c));
  const oddities = [
    entity(30, 'vehicle', 'base:runaway-mobile-home'),
    entity(31, 'vehicle', 'base:parked-boat'),
    entity(32, 'vehicle', 'base:box-truck'),
  ];
  views.sync(null, snap([...peds, ...oddities]), 1, 0);
  const meshes = new Map(
    views.root.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh).map((m) => [m.name, m]),
  );
  /** The world-space box of instance 0 of a mesh. */
  const sizeOf = (name: string) => {
    const mesh = meshes.get(name);
    if (!mesh) throw new Error(`no ${name}`);
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    mesh.geometry.computeBoundingBox();
    const box = (mesh.geometry.boundingBox ?? new Box3()).clone();
    return box.applyMatrix4(m).getSize(new Vector3());
  };

  it('puts each in its own instanced mesh, one instance each', () => {
    const drawn = Object.fromEntries(
      [...meshes].filter(([, m]) => m.count > 0).map(([n, m]) => [n, m.count]),
    );
    console.log(`[examined] drawn instanced meshes: ${JSON.stringify(drawn)}`);
    expect(drawn).toEqual({
      'views-truck': 1,
      'views-ped': 1,
      'views-iguana': 1,
      'views-pelican': 1,
      'views-gator': 1,
      'views-lawnGator': 1,
      'views-critter': 1,
      'views-mobileHome': 1,
      'views-boatTrailer': 1,
    });
    expect(views.viewCounts().peds).toBe(6);
    expect(views.viewCounts().vehicles).toBe(3);
  });

  const fmt = (v: Vector3) =>
    v
      .toArray()
      .map((n) => n.toFixed(2))
      .join(' x ');

  it('sizes each to its type: a low iguana, a long gator, a pelican under a person, a house-sized mobile home', () => {
    const iguana = sizeOf('views-iguana');
    const gator = sizeOf('views-gator');
    const pelican = sizeOf('views-pelican');
    const person = sizeOf('views-ped');
    const home = sizeOf('views-mobileHome');
    const truck = sizeOf('views-truck');
    console.log(
      `[examined] sizes (w x h x l): iguana ${fmt(iguana)}, gator ${fmt(gator)}, pelican ${fmt(pelican)}, person ${fmt(person)}, mobile home ${fmt(home)}`,
    );
    expect(iguana.y).toBeLessThan(0.35);
    expect(gator.z).toBeGreaterThan(2.2);
    expect(gator.y).toBeLessThan(0.5);
    expect(pelican.y).toBeLessThan(person.y);
    expect(home.z).toBeGreaterThan(7);
    expect(home.y).toBeGreaterThan(3);
    // Not the truck box: a different geometry.
    expect(meshes.get('views-mobileHome')!.geometry).not.toBe(meshes.get('views-truck')!.geometry);
    expect(truck.y).toBeGreaterThan(3);
  });

  it('makes no figure meshes for a race without animals or oddities', () => {
    const plain = new EntityViews(createFlatLook());
    plain.sync(null, snap([entity(1, 'ped', 'base:fisherman'), entity(2, 'vehicle', 'base:sedan')]), 1, 0);
    const names = plain.root.children.filter((c) => c instanceof InstancedMesh).map((c) => c.name);
    expect(names.sort()).toEqual(['views-car', 'views-ped', 'views-truck']);
  });
});
