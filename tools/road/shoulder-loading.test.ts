import { describe, expect, it, vi } from 'vitest';

async function cold() {
  // The global setup prepares race physics. This independent graph represents an early menu read.
  vi.resetModules();
  const [network, fixture, course, structures] = await Promise.all([
    import('../../src/road/network'),
    import('../../src/road/fixture'),
    import('../../src/road/course'),
    import('../../src/road/structures'),
  ]);
  const bundle = fixture.fixtureNetwork([{ id: 'plain', lengthM: 100, kappa: 0 }]);
  const road = network.createRoadNetwork({
    ...bundle,
    network: { ...bundle.network, terrain: { patches: [] } },
  });
  const outer = road.edges[0]!.dMax + 0.6;
  const query = () => course.roadBandHeight(road, 0, 50, outer + 0.005);
  return { road, outer, query, course, structures };
}

describe('shoulder physics uses the already-awaited race-world loading boundary', () => {
  it('early presentation invents no support; planner preparation enables identical cold and warm queries', async () => {
    const world = await cold();
    expect(world.course.roadBandHeight(world.road, 0, 50, 0)).toBe(0);
    expect(world.query()).toBeNull();
    await world.structures.loadStructurePlanners({});
    const first = world.query();
    expect(first).toBe(0);
    for (let i = 0; i < 100; i++) expect(world.query()).toBe(first);
    await world.structures.loadStructurePlanners({});
    expect(world.query()).toBe(first);
    const sampling = await import('../../src/road/surface-sampling');
    expect(() =>
      sampling.installPlainShoulderSupport(
        () => false,
        () => undefined,
      ),
    ).toThrow(/already installed/);
    expect(world.query()).toBe(first);
    expect(world.course.roadBandHeight(world.road, 0, 50, world.outer + 0.1)).toBeNull();
  });

  it('ensureStructures prepares support even when the requested structure plan is already cached', async () => {
    const world = await cold();
    const plan = world.structures.planStructures(world.road, 1, {}, {});
    expect(world.query()).toBeNull();
    expect(await world.structures.ensureStructures(world.road, 1, {})).toBe(plan);
    expect(world.query()).toBe(0);
    expect(await world.structures.ensureStructures(world.road, 1, {})).toBe(plan);
    expect(world.query()).toBe(0);
  });

  it('early menu creation stays conservative; the public step loader prepares actual races before snapshots', async () => {
    const world = await cold();
    const api = await import('../../src/sim/api');
    const { testConfig } = await import('../../src/sim/riders/testing');
    const config = { ...testConfig({ edges: [{ id: 'plain', lengthM: 100, kappa: 0 }] }), road: world.road };
    const early = api.createSim(config);
    expect(early.snapshot().entities.length).toBeGreaterThan(0);
    expect(world.query()).toBeNull();
    expect(() => early.step([])).toThrow(/step has not loaded/);
    await api.loadSimSteps();
    const actual = api.createSim(config);
    expect(actual.tick).toBe(0);
    expect(world.query()).toBe(0);
    await api.loadSimSteps();
    const again = api.createSim(config);
    actual.step([]);
    again.step([]);
    expect(actual.hash()).toBe(again.hash());
    expect(world.query()).toBe(0);
  });

  it('a retained early sim matches a newly prepared sim on distinct equivalent shoulder plans', async () => {
    const early = await cold();
    const [api, creation, fixture, network, route, testing, riders] = await Promise.all([
      import('../../src/sim/api'),
      import('../../src/sim/create'),
      import('../../src/road/fixture'),
      import('../../src/road/network'),
      import('../../src/road/route'),
      import('../../src/sim/riders/testing'),
      import('../../src/sim/riders'),
    ]);
    const edges = [{ id: 'plain', lengthM: 100, kappa: 0 }];
    const bundle = fixture.fixtureNetwork(edges);
    const preparedRoad = network.createRoadNetwork({
      ...bundle,
      network: { ...bundle.network, terrain: { patches: [] } },
    });
    expect(preparedRoad).not.toBe(early.road);
    const configFor = (road: typeof early.road) => ({
      ...testing.testConfig({ edges, tuning: { 'ground.offRoad': 1, 'riders.courseEdges': 1 } }),
      road,
      route: route.createRouteProgress(road, {
        id: 'r',
        network: 'fixture',
        start: { road: 'plain', s: 40, dir: 1 },
        finish: { road: 'plain', s: 80 },
        mainPath: ['plain'],
        allowedRoads: ['plain'],
        closed: false,
      }),
    });
    const retained = creation.createSimWithWorld(configFor(early.road));
    expect(early.query()).toBeNull();
    // Never step this retained world while unprepared: a rejected step can already mutate it.
    await api.loadSimSteps();
    const prepared = creation.createSimWithWorld(configFor(preparedRoad));
    const box = api.hitboxOf(retained.sim.config.riders[0]!.hitbox);
    const d = early.outer - box.widthM / 2 + 0.005;
    for (const race of [retained, prepared]) {
      const me = race.world.movers.find((m) => m.kind === 'rider')!;
      me.pos = { edge: 0, s: 40, d, dir: 1 };
      me.speed = 6;
      me.yaw = 0;
      riders.riderState(race.world).yAbs[me.id] = 0;
    }
    expect(d + box.widthM / 2).toBeGreaterThan(early.outer);
    const initialHash = retained.sim.hash();
    expect(initialHash).toBe(prepared.sim.hash());
    for (let tick = 0; tick < 90; tick++) {
      const command = tick < 60 ? testing.input(0.6) : testing.input(0, 0.2);
      retained.sim.step([command]);
      prepared.sim.step([command]);
      expect(retained.sim.hash()).toBe(prepared.sim.hash());
      expect(retained.sim.events()).toEqual(prepared.sim.events());
      const snapshot = retained.sim.snapshot();
      expect(snapshot).toEqual(prepared.sim.snapshot());
      const me = snapshot.entities.find((m) => m.kind === 'rider')!;
      expect(me.mode).toBe('Road');
      expect(me.road.yaw).toBe(0);
      expect(me.road.d).toBe(d);
      // The sim reads the centre; these explicit body-corner reads exercise the added mesh lap.
      // The prepared road's prewarm cannot populate the retained road's WeakMap entry.
      const support = (road: typeof early.road) =>
        [-box.lengthM / 2, box.lengthM / 2].flatMap((along) =>
          [-box.widthM / 2, box.widthM / 2].map((across) =>
            early.course.roadBandHeight(road, 0, me.road.s + along, me.road.d + across),
          ),
        );
      expect(support(early.road)).toEqual([0, 0, 0, 0]);
      expect(support(preparedRoad)).toEqual(support(early.road));
      for (const road of [early.road, preparedRoad])
        expect(early.course.roadBandHeight(road, 0, me.road.s, early.outer + 0.1)).toBeNull();
    }
    expect(retained.sim.tick).toBe(90);
    expect(retained.sim.hash()).not.toBe(initialHash);
    expect(retained.sim.snapshot().entities[0]!.road.s).toBeGreaterThan(40);
  });
});
