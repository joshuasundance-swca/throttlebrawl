// Far, tiny things are not drawn (main went red, 2026-10-02: the road-events browser check measured
// 122 and 129 draw calls in the Pacific Northwest and San Francisco, over the 120 budget). A
// one-frame breakdown at the San Francisco crash scene found draw calls spent on things a phone
// cannot show: roadside weapons 350 to 670 m off (two draw calls each, a pixel or less at that
// range; #303 put one about every 500 m), a weapon in a far rival's fist, and billboards past the
// scenery draw distance (two draw calls each, standing where the houses round them are already
// hidden). So a weapon, on the road or in a fist, is drawn only within PICKUP_DRAW_M of the camera,
// and a board only within render.sceneryDrawM, like the scenery.
import type { Mesh, Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { createRoadNetwork, fixtureNetwork } from '../road';
import type { EntitySnapshot, SimSnapshot } from '../sim/api';
import { Boards, type BoardCatalog, type BoardSlot } from './boards';
import { FeelEffects } from './effects';
import { createFlatLook } from './look';
import { defaultRenderParams } from './tuning';
import { EntityViews, PICKUP_DRAW_M } from './views';

const pickup = (id: number, x: number, z: number): EntitySnapshot => ({
  id,
  kind: 'pickup',
  mode: 'Road',
  road: { edge: 0, s: 100, d: 0, h: 0, dir: 1, yaw: 0 },
  x,
  y: 0,
  z,
  heading: 0,
  speed: 0,
  lean: 0,
  contentId: 'base:lead-pipe',
  name: 'pipe',
  faction: 'rider',
  slot: -1,
  throttle: 0,
  rpm: 0,
  gear: 0,
  grounded: true,
  health: 1,
  healthMax: 1,
  attackPhase: 'idle',
  heldWeapon: null,
  targetId: -1,
  lastAttackerId: -1,
  progress: 0,
  distanceToFinish: 0,
  place: 0,
  finished: false,
});

const snap = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 3500, finishOrder: [] },
});

/** Whether the pickup view drawn for entity `id` is shown (its root and every parent visible). */
function pickupShown(views: EntityViews, id: number): boolean {
  const roots: Object3D[] = [];
  views.root.traverse((o) => {
    if ((o as Mesh).isMesh && o.name === 'views-pickup-weapon' && o.parent) roots.push(o.parent);
  });
  const root = roots[id];
  if (!root) throw new Error(`no pickup view ${id}`);
  for (let o: Object3D | null = root; o; o = o.parent) if (!o.visible) return false;
  return true;
}

describe('draw distance: roadside weapons', () => {
  it('draws a pickup within PICKUP_DRAW_M of the camera, and not one farther out', () => {
    const look = createFlatLook();
    const params = defaultRenderParams();
    const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
    const camera = { x: 10, z: -50 };
    const near = pickup(1, camera.x, camera.z - (PICKUP_DRAW_M - 20));
    const far = pickup(2, camera.x + 30, camera.z - (PICKUP_DRAW_M + 40));
    views.sync(null, snap([near, far]), 1, 0, camera);
    expect(pickupShown(views, 0), 'the near pickup').toBe(true);
    expect(pickupShown(views, 1), 'the far pickup').toBe(false);
    // Both are still live views (the pool and the counts are unchanged); only the draw is skipped.
    expect(views.viewCounts().pickups).toBe(2);
    // The camera comes up to the far one: it is drawn again.
    views.sync(null, snap([near, far]), 1, 0.1, { x: far.x, z: far.z + 50 });
    expect(pickupShown(views, 1), 'the far pickup, now near').toBe(true);
  });

  it("draws a weapon in a rival's fist only within PICKUP_DRAW_M of the camera", () => {
    const look = createFlatLook();
    const params = defaultRenderParams();
    const views = new EntityViews(look, { effects: new FeelEffects(look, params), params });
    const rival: EntitySnapshot = {
      ...pickup(3, 0, -100),
      kind: 'rider',
      slot: 1,
      speed: 30,
      heldWeapon: 'base:lead-pipe',
      contentId: 'base:r1',
    };
    let weapon: Mesh | null = null;
    views.sync(null, snap([rival]), 1, 0, { x: 0, z: -100 + PICKUP_DRAW_M - 30 });
    views.root.traverse((o) => {
      if (o.name === 'views-weapon') weapon = o as Mesh;
    });
    expect(weapon, 'the held weapon view').not.toBeNull();
    expect((weapon as Mesh | null)?.visible, 'held, near').toBe(true);
    views.sync(null, snap([rival]), 1, 0.1, { x: 0, z: -100 + PICKUP_DRAW_M + 30 });
    expect((weapon as Mesh | null)?.visible, 'held, far').toBe(false);
  });

  it('keeps a pickup at a few pixels at its cut-off (so it does not pop in large)', () => {
    // 62 degrees of view over a 412 px phone landscape height: the pipe (0.9 m at 1.3x) at the cut-off.
    const pxPerRad = 412 / ((62 * Math.PI) / 180);
    expect((0.9 * 1.3 * pxPerRad) / PICKUP_DRAW_M).toBeLessThan(3);
  });
});

describe('draw distance: boards', () => {
  const road = createRoadNetwork(fixtureNetwork([{ id: 'flat', lengthM: 900, kappa: 0 }]));
  const catalog: BoardCatalog = {
    items: {
      a: {
        ref: 'base:region/x#a',
        text: 'PARADISE FOR SALE. Some pieces still above water.',
        kind: 'billboard',
      },
      b: { ref: 'base:region/x#b', text: 'BRIDGE TOLL $9. View not included.', kind: 'sign' },
    },
  };
  const slots: BoardSlot[] = [
    { kind: 'billboard', id: 'near', s0: 100, s1: 120, d0: 8, d1: 17, item: 'a' },
    { kind: 'billboard', id: 'far', s0: 800, s1: 810, d0: -9, d1: -6.5, item: 'b' },
  ];

  it('draws a board within the scenery draw distance, not one past it, and never a vetoed one', () => {
    const boards = new Boards(createFlatLook());
    boards.build(road, () => slots, catalog);
    const [near, far] = boards.all();
    if (!near || !far) throw new Error('expected two boards');
    const drawM = defaultRenderParams().sceneryDrawM;
    // The camera 60 m before the near board: the far one is about 700 m off.
    const at = near.centre.clone().lerp(far.centre, -60 / near.centre.distanceTo(far.centre));
    expect(far.centre.distanceTo(at)).toBeGreaterThan(drawM + 20);
    expect(boards.update(at.x, at.z, drawM)).toBe(1);
    expect(near.group.visible).toBe(true);
    expect(far.group.visible).toBe(false);
    // A longer draw distance (the slider) reaches it.
    expect(boards.update(at.x, at.z, 760)).toBe(2);
    expect(far.group.visible).toBe(true);
    // A veto hides the near board whatever the distance, and it stays hidden.
    boards.hide([near.ref]);
    expect(boards.update(at.x, at.z, 760)).toBe(1);
    expect(near.group.visible).toBe(false);
  });
});
