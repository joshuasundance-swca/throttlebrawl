/// <reference types="vite/client" />
import { realRoutes } from '../../src/app';
import { lookup, registryFromGlob } from '../../src/content';
import { LANDING_FILES } from './landing-group.mjs';

// Scheduling preserves the existing three-event cohort. Iowa was not part of this survey.
export const LANDING_EVENTS = [
  'base:m1-skeleton-sprint',
  'region-pnw:pnw-fogline-run',
  'region-sf:sf-hill-sprint',
];
export const LANDING_SEEDS = [1, 2];
export interface LandingCase {
  event: string;
  route: string | null;
  seed: number;
  thumb: boolean;
}
export const LANDING_REGISTRY = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
export const landingKey = (c: LandingCase) => JSON.stringify([c.event, c.route, c.seed, c.thumb]);
/** Same event, route, seed and player-policy order as the original serial survey. */
export function landingCases(): LandingCase[] {
  return LANDING_EVENTS.flatMap((event) => {
    const ev = lookup(LANDING_REGISTRY.events, event);
    const routes = [
      ...new Set(ev.lengths.map((l) => `length:${l.id}`)),
      ...realRoutes(LANDING_REGISTRY, event),
    ];
    return routes.flatMap((route) =>
      LANDING_SEEDS.flatMap((seed) => [false, true].map((thumb) => ({ event, route, seed, thumb }))),
    );
  });
}
export function landingManifest() {
  const routes = new Map<string, number>();
  const cases = landingCases().map((c) => {
    const route = JSON.stringify([c.event, c.route]);
    if (!routes.has(route)) routes.set(route, routes.size);
    return { ...c, key: landingKey(c), file: LANDING_FILES[routes.get(route)! % LANDING_FILES.length]! };
  });
  if (
    new Set(LANDING_FILES).size !== LANDING_FILES.length ||
    new Set(cases.map((c) => c.key)).size !== cases.length ||
    LANDING_FILES.some((file) => !cases.some((c) => c.file === file))
  )
    throw new Error('Invalid complete landing survey inventory');
  return { files: LANDING_FILES, cases };
}
