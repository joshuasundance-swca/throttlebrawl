import { expect, it } from 'vitest';
import { fixtureNetwork } from '../../road';
import { addMover, createWorld, emit, stepWorld, type SimSystem } from '../world';
import type { SimEvent } from '../types';
import { gapSimConfig } from './gap-fixture';
import { centre } from './rig';
import { tumbleRecord, tumbleSystem } from './index';

it.each([true, false])(
  'the loaded tumble system keeps ground and legacy floors for both bodies (honest edges: %s)',
  (honest) => {
    const bundle = fixtureNetwork([{ id: 'a', lengthM: 200, kappa: 0 }]);
    const config = gapSimConfig(
      {
        ...bundle,
        roads: bundle.roads.map((r) => ({
          ...r,
          barriers: [],
          tags: [{ tag: 'bluff', side: 'right', s0: 0, s1: 200 }],
        })),
      },
      { tuning: { 'ground.offRoad': 1, 'riders.courseEdges': honest ? 1 : 0, 'riders.structures': 0 } },
    );
    const outer = config.road.vergeAt(0, 100, 'right').dOuter;
    const world = createWorld(config);
    const player = addMover(world, 'rider', { edge: 0, s: 100, d: outer + 0.5, dir: 1 }, 0);
    player.h = 3;
    const injector: SimSystem = {
      name: 'combat',
      init() {},
      step(w) {
        if (w.tick === 0) emit(w, 'crash', player.id, { sideMps: 1, upMps: -3 });
      },
    };
    tumbleSystem.init(world, config);
    const events: SimEvent[] = [];
    events.push(...stepWorld(world, config, [injector, tumbleSystem], []));
    const record = tumbleRecord(world, player.id);
    if (!record) throw new Error('crash did not start');
    for (let tick = 0; tick < 180 && !(record.riderRig.splashed && record.bikeRig.splashed); tick++)
      events.push(...stepWorld(world, config, [injector, tumbleSystem], []));
    for (const body of [record.riderRig, record.bikeRig]) {
      expect(body.overboard, `${body.kind} crossed the parapet`).toBe(true);
      expect(body.splashed, `${body.kind} reached its floor`).toBe(true);
      const at = centre(body.p);
      const lowest = Math.min(...body.p.map((p) => p.y));
      console.info(
        `[tumble-step] honest ${honest}, ${body.kind}: centre ${at.y.toFixed(6)}, lowest ${lowest.toFixed(6)}`,
      );
      // The drawn shelf is -0.09 m below the flat road. With the legacy switch off,
      // each body's centre instead stops on its network-level water plane at 0 m.
      expect(honest ? lowest : at.y, body.kind).toBeCloseTo(honest ? -0.09 : 0, 5);
      expect(config.road.project(at.x, at.z, 0).d, body.kind).toBeGreaterThan(outer);
      expect(events.find((e) => e.type === 'railOver' && e.data['body'] === body.kind)?.data['past']).toBe(
        honest ? 'ground' : 'drop',
      );
    }
  },
);
