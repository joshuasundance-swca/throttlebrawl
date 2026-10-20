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
});
