// A headless race from the real content, with no DOM and no Three.js: for the bot's unit test,
// dev-1's seeded-race batch and dev-2's self-test. Every slot's inputs come from the caller. The
// base pack by default; a caller that carries region packs (a sim test, from `registryFromGlob`)
// passes its registry and races any region's event (`setup.eventId`).
import { loadBasePack, type ContentRegistry } from '../content';
import { createSim, type RouteQueries, type Sim, type SimConfig } from '../sim/api';
import { buildSimConfig, DEFAULT_EVENT, type RaceSetup } from './config';
import { createStreamCache } from './regions';

export interface HeadlessRace {
  sim: Sim;
  config: SimConfig;
  /** The route the bot follows. */
  route: RouteQueries;
  /** The player's entity id. */
  playerId: number;
}

const streams = createStreamCache();

export interface HeadlessOptions {
  /**
   * Load draft content too, as the dev and staging builds do (default false, like prod). The
   * seeded batch and the self-test use it so content that lands as a draft is exercised.
   */
  includeDrafts?: boolean;
  /** The registry to race from (default: the base pack). Its road data must be loaded. */
  registry?: ContentRegistry;
}

export function createHeadlessRace(setup: Partial<RaceSetup> = {}, opts: HeadlessOptions = {}): HeadlessRace {
  const reg = opts.registry ?? loadBasePack({ includeDrafts: opts.includeDrafts ?? false });
  const stream = streams.forEvent(reg, setup.eventId ?? DEFAULT_EVENT, setup.length);
  const config = buildSimConfig(reg, stream, { seed: setup.seed ?? 1, ...setup });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  return { sim, config, route: config.route, playerId };
}
