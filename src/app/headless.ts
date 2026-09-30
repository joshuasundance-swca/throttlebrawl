// A headless race from the real base pack, with no DOM and no Three.js: for the bot's unit test,
// dev-1's seeded-race batch and dev-2's self-test. Every slot's inputs come from the caller.
import { loadBasePack } from '../content';
import { createSim, type RouteQueries, type Sim, type SimConfig } from '../sim/api';
import type { RegionStream } from '../stream';
import { buildSimConfig, streamForEvent, type RaceSetup } from './config';

export interface HeadlessRace {
  sim: Sim;
  config: SimConfig;
  /** The route the bot follows. */
  route: RouteQueries;
  /** The player's entity id. */
  playerId: number;
}

let stream: RegionStream | null = null;

export interface HeadlessOptions {
  /**
   * Load draft content too, as the dev and staging builds do (default false, like prod). The
   * seeded batch and the self-test use it so content that lands as a draft is exercised.
   */
  includeDrafts?: boolean;
}

export function createHeadlessRace(setup: Partial<RaceSetup> = {}, opts: HeadlessOptions = {}): HeadlessRace {
  const reg = loadBasePack({ includeDrafts: opts.includeDrafts ?? false });
  stream ??= streamForEvent(reg, setup.eventId);
  const config = buildSimConfig(reg, stream, { seed: setup.seed ?? 1, ...setup });
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  return { sim, config, route: config.route, playerId };
}
