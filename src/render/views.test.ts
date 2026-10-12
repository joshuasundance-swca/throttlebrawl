import { BoxGeometry, Group, InstancedMesh, Matrix4 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AssetManifest } from '../assets';
import * as content from '../content';
import type { EntitySnapshot, SimSnapshot, SimTrafficTypeDef } from '../sim/api';
import { createFlatLook } from './look';
import { deferred } from './presentation.test-util';
import type { PresentationScope } from './presentation';
import type { VehicleSets } from './vehicles';
import { EntityViews } from './views';

afterEach(() => vi.restoreAllMocks());
const type: SimTrafficTypeDef = {
  contentId: 'base:probe',
  category: 'car',
  lengthM: 4,
  widthM: 2,
  cruiseMps: 1,
  hazard: 'normal',
};
const entity = (
  id: number,
  kind: EntitySnapshot['kind'],
  over: Partial<EntitySnapshot> = {},
): EntitySnapshot => ({
  id,
  kind,
  mode: 'Road',
  road: { edge: 0, s: 1, d: 0, h: 0, dir: 1, yaw: 0 },
  x: id,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  lean: 0,
  contentId: type.contentId,
  name: 'probe',
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
  distanceToFinish: 10,
  place: 1,
  finished: false,
  ...over,
});
const snapshot = (entities: EntitySnapshot[]): SimSnapshot => ({
  tick: 1,
  timeScale: 1,
  entities,
  race: { over: false, routeLength: 10, finishOrder: [] },
});
const internal = (v: EntityViews) =>
  v as unknown as {
    dives: Map<number, unknown>;
    gestures: Map<number, unknown>;
    getUps: Map<number, unknown>;
    fists: Map<number, unknown>;
    vehicleSets: VehicleSets;
    vehicleGeometries: Map<string, unknown>;
    pending: unknown[];
    wobbles: Map<number, unknown>;
    kicks: Set<number>;
    flashes: Map<number, unknown>;
    prevById: Map<number, unknown>;
    now: number;
    dt: number;
  };
function owner() {
  let epoch = 0;
  const scope: PresentationScope = {
    capture: () => {
      const at = epoch;
      return () => at === epoch;
    },
  };
  return {
    scope,
    advance: () => {
      epoch++;
    },
  };
}

describe('EntityViews exact reset and vehicle presentation edges', () => {
  it('clears four reused-ID pose maps and draws baseline pedestrian/on-foot poses', () => {
    const look = createFlatLook();
    const v = new EntityViews(look);
    const entities = [
      entity(7, 'ped'),
      entity(8, 'ped'),
      entity(9, 'rider', { mode: 'OnFoot' }),
      entity(10, 'rider', { mode: 'OnFoot' }),
    ];
    const snap = snapshot(entities);
    v.sync(null, snap, 1, 0);
    v.pushEvents([
      { tick: 1, type: 'pedDive', actor: 7, data: {} },
      { tick: 1, type: 'pedReact', actor: 8, data: { kind: 'film', ticks: 120 } },
      { tick: 1, type: 'getUp', actor: 9, data: {} },
      { tick: 1, type: 'fistShake', actor: 10, data: {}, target: 9 },
      { tick: 1, type: 'hit', actor: 10, target: 9, data: {} },
    ]);
    const state = internal(v);
    for (const name of ['dives', 'gestures', 'getUps', 'fists'] as const) expect(state[name].size).toBe(1);
    v.sync(snap, snap, 1, 0.1);
    const matrices = (views: EntityViews) =>
      views.root.children
        .filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.count > 0)
        .map((mesh) => {
          const rows = [];
          for (let i = 0; i < mesh.count; i++) {
            const m = new Matrix4();
            mesh.getMatrixAt(i, m);
            rows.push(m.elements);
          }
          return [mesh.name, rows];
        });
    const poses = (views: EntityViews) =>
      views.root.children
        .filter((c): c is Group => c instanceof Group && c.userData['entityId'] !== undefined)
        .map((g) => g.children.map((c) => [c.name, c.position.toArray(), c.rotation.toArray()]));
    const active = matrices(v);
    v.resetTransient();
    for (const name of [
      'dives',
      'gestures',
      'getUps',
      'fists',
      'wobbles',
      'flashes',
      'prevById',
      'kicks',
    ] as const)
      expect(state[name].size).toBe(0);
    expect(state.pending).toEqual([]);
    expect(state.now).toBe(0);
    expect(state.dt).toBe(0);
    v.sync(null, snap, 1, 0);
    const baseline = new EntityViews(look);
    baseline.sync(null, snap, 1, 0);
    expect(active).not.toEqual(matrices(baseline));
    expect(matrices(v)).toEqual(matrices(baseline));
    expect(poses(v)).toEqual(poses(baseline));
  });

  it.each(['chunk', 'sets', 'final-commit'] as const)(
    'rejects retired traffic models at the %s edge, with a live geometry positive control',
    async (edge) => {
      const own = owner();
      const v = new EntityViews(createFlatLook(), { assets: {} as AssetManifest }, own.scope);
      const module = deferred<unknown>();
      const loaded = deferred<VehicleSets>();
      const ask = vi.fn(() => loaded.promise);
      vi.spyOn(content, 'loadChunk').mockImplementation(() => module.promise);
      const geometry = new BoxGeometry(1, 1, 1);
      const model = {
        asset: 'probe-model',
        geometry,
        lengthM: 1,
        widthM: 1,
        heightM: 1,
        hoodAt: { y: 0.5, z: 0 },
      };
      const sets: VehicleSets = new Map([[type.contentId, { variants: [model], paint: ['#ffffff'] }]]);
      v.setTrafficTypes([type]);
      if (edge === 'chunk') own.advance();
      module.resolve({ loadVehicleSets: ask });
      await module.promise;
      await Promise.resolve();
      if (edge !== 'chunk') expect(ask).toHaveBeenCalledOnce();
      else expect(ask).not.toHaveBeenCalled();
      if (edge === 'sets') own.advance();
      loaded.resolve(sets);
      await loaded.promise;
      await Promise.resolve();
      await Promise.resolve();
      const state = internal(v);
      if (edge !== 'final-commit') {
        expect(state.vehicleSets.size).toBe(0);
        expect(state.vehicleGeometries.size).toBe(0);
      }
      vi.restoreAllMocks();
      v.setVehicleModels(sets);
      v.sync(null, snapshot([entity(4, 'vehicle')]), 1, 0);
      const mesh = v.root.children.find(
        (c): c is InstancedMesh => c instanceof InstancedMesh && c.geometry === geometry,
      );
      expect(mesh).toBeDefined();
      const replacement = new BoxGeometry(0.5, 0.5, 0.5);
      const next: VehicleSets = new Map([
        [type.contentId, { variants: [{ ...model, geometry: replacement }], paint: ['#ffffff'] }],
      ]);
      const current = own.scope.capture();
      own.advance();
      v.setVehicleModels(next, current);
      expect(state.vehicleSets).toBe(sets);
      expect([...state.vehicleGeometries.values()]).toContain(geometry);
      expect(mesh!.geometry).toBe(geometry);
      v.setVehicleModels(next);
      expect(state.vehicleSets).toBe(next);
      expect([...state.vehicleGeometries.values()]).toContain(replacement);
      expect(mesh!.geometry).toBe(replacement);
    },
  );
});
