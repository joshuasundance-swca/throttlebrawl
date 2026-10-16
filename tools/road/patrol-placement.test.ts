import { expect, it } from 'vitest';
import { buildSimConfig, createStreamCache, realRoutes, regionChoices } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { patrolSpots } from '../../src/sim/cops';
import { createWorld } from '../../src/sim/world';

// Configuration only: the full cops-patrol simulation still checks the encounter and response.
const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const streams = createStreamCache();
const cases = regionChoices(registry).flatMap((choice) => {
  const event = lookup(registry.events, choice.eventId);
  if (!(Number(event.cops?.patrolMax ?? 0) > 0)) return [];
  return [
    ...event.lengths.map((length) => ({
      label: `${choice.name}: ${length.id}`,
      eventId: choice.eventId,
      length: length.id,
      route: undefined,
    })),
    ...realRoutes(registry, choice.eventId).map((route) => ({
      label: `${choice.name}: ${route}`,
      eventId: choice.eventId,
      length: undefined,
      route,
    })),
  ];
});

it('examines authored menu races that request patrols', () => {
  expect(cases.length).toBeGreaterThan(0);
});

for (const scenario of cases) {
  it(`${scenario.label} has safe patrol parking`, () => {
    for (const seed of [1, 2, 3]) {
      const setup = {
        seed,
        eventId: scenario.eventId,
        ...(scenario.length ? { length: scenario.length } : {}),
        ...(scenario.route ? { route: scenario.route } : {}),
      };
      const stream = streams.forEvent(registry, scenario.eventId, scenario.length, scenario.route);
      const config = buildSimConfig(registry, stream, setup);
      expect(patrolSpots(createWorld(config), config, 1).length, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
}
