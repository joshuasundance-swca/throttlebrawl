// Each weapon draws as its own shape (weapons.ts): the id-to-shape mapping covers every weapon in
// the packs, the shapes differ, and a held weapon and a pickup on the road take the shape of the
// weapon they are.
import { Box3, Vector3, type Mesh, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { FeelEffects } from './effects';
import { mergeBoxes } from './geometry';
import { createFlatLook } from './look';
import { defaultRenderParams } from './tuning';
import { EntityViews } from './views';
import { WEAPON_PARTS, WEAPON_SHAPES, weaponShapeOf } from './weapons';

const WEAPON_FILES = import.meta.glob<{ id: string; unarmed?: boolean }>('/packs/*/weapons/*.json', {
  eager: true,
  import: 'default',
});

const entity = (over: Partial<EntitySnapshot>): EntitySnapshot => ({
  id: 0,
  kind: 'rider',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x: 0,
  y: 1,
  z: -100,
  heading: 0,
  speed: 25,
  lean: 0,
  contentId: 'base:r0',
  name: 'r0',
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
  distanceToFinish: 1000,
  place: 1,
  finished: false,
  ...over,
});

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

function find(root: Object3D, name: string): Mesh {
  let hit: Mesh | null = null;
  root.traverse((o) => {
    if (o.name === name && !hit) hit = o as Mesh;
  });
  if (!hit) throw new Error(`no ${name}`);
  return hit;
}

/** A shape's size and part count, to tell shapes apart. */
const signature = (shape: (typeof WEAPON_SHAPES)[number]): string => {
  const g = mergeBoxes([...WEAPON_PARTS[shape]]);
  g.computeBoundingBox();
  const size = (g.boundingBox as Box3).getSize(new Vector3());
  return `${WEAPON_PARTS[shape].length}:${size.x.toFixed(2)}x${size.y.toFixed(2)}x${size.z.toFixed(2)}`;
};

describe('weapon shapes', () => {
  it('maps every melee weapon in the packs to a shape, and each kind to its own', () => {
    const ids = Object.values(WEAPON_FILES)
      .filter((w) => !w.unarmed)
      .map((w) => w.id);
    expect(ids.length).toBeGreaterThanOrEqual(7);
    const shapes = ids.map((id) => [id, weaponShapeOf(`base:${id}`)] as const);
    expect(Object.fromEntries(shapes)).toMatchObject({
      'lead-pipe': 'pipe',
      'bike-chain': 'chain',
      'driftwood-club': 'club',
      'campaign-sign': 'sign',
      'kevins-briefcase': 'briefcase',
      baton: 'baton',
      taser: 'taser',
      // W-T: one local weapon per region.
      'lawn-flamingo': 'flamingo',
      'canoe-paddle': 'paddle',
      'dead-rental-scooter': 'scooter',
    });
    expect(new Set(shapes.map(([, s]) => s)).size).toBe(shapes.length);
    expect(weaponShapeOf(null)).toBe('pipe');
    expect(weaponShapeOf('some-future-weapon')).toBe('pipe');
  });

  it('draws every shape as a different silhouette', () => {
    expect(WEAPON_SHAPES.length).toBe(10);
    const sigs = WEAPON_SHAPES.map(signature);
    expect(new Set(sigs).size).toBe(WEAPON_SHAPES.length);
  });

  it('shows a held weapon as its own shape, switching when the weapon changes', () => {
    const look = createFlatLook();
    const params = defaultRenderParams();
    const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
    const geometryOf = (weapon: string) => {
      views.sync(null, snap([entity({ heldWeapon: weapon })]), 1, 0);
      return find(views.root, 'views-weapon').geometry;
    };
    const pipe = geometryOf('base:lead-pipe');
    const chain = geometryOf('base:bike-chain');
    const briefcase = geometryOf('base:kevins-briefcase');
    expect(new Set([pipe, chain, briefcase]).size).toBe(3);
    expect(geometryOf('base:bike-chain')).toBe(chain);
  });

  it('draws a weapon lying on the road as its shape', () => {
    const look = createFlatLook();
    const params = defaultRenderParams();
    const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
    const pickup = (weapon: string) => entity({ id: 7, kind: 'pickup', contentId: weapon, slot: -1 });
    views.sync(null, snap([pickup('base:driftwood-club')]), 1, 0);
    const club = find(views.root, 'views-pickup-weapon').geometry;
    views.sync(null, snap([pickup('base:taser')]), 1, 0);
    const taser = find(views.root, 'views-pickup-weapon').geometry;
    expect(club).not.toBe(taser);
  });
});
