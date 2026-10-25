import { createHeadlessRace, qualifyIn, realRoutes } from '../../src/app';
import { lookup, packOf, type ContentRegistry } from '../../src/content';
import { ISOLATED } from './batch';

/** Recovery belongs to a playable course, including the network's separately offered arms. */
export function eagleRecoveryConfigs(registry: ContentRegistry, playerBike: string) {
  const eventId = 'region-clinton:clinton-ia136-race';
  const originalId = 'region-clinton:osm-clinton-eagle-point-run';
  const networkOf = (route: string) => {
    const network = lookup(registry.routes, route).network;
    if (!network) throw new Error('A real-road recovery case requires a network');
    return qualifyIn(packOf(route), network);
  };
  const configFor = (route: string) =>
    createHeadlessRace(
      {
        seed: 1,
        eventId,
        route,
        playerBike,
        eventPatch: { riders: [] },
        tuning: { ...ISOLATED, 'ground.offRoad': 1, 'riders.courseEdges': 1 },
      },
      { registry },
    ).config;
  const original = configFor(originalId);
  const courses = realRoutes(registry, eventId)
    .filter((route) => networkOf(route) === networkOf(originalId))
    .map((route) => (route === originalId ? original : configFor(route)));
  return { original, courses };
}
