/// <reference types="vite/client" />
import { expect, it } from 'vitest';
import { createHeadlessRace } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createBot, moverProblem } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { firstSeed, NO_ROAD_EVENTS } from './batch';

const registry = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));

function race(seed: number) {
  const { sim, route, playerId, config } = createHeadlessRace(
    { seed, eventId: 'region-clinton:clinton-ia136-race', tuning: NO_ROAD_EVENTS },
    { registry },
  );
  const bot = createBot();
  const trafficDirections = new Set<number>();
  const trafficKinds = new Set<string>();
  const problems = new Set<string>();
  let snapshot = sim.snapshot();
  while (!sim.isOver() && sim.tick < 60 * 60 * 6) {
    const actions = emptyActions();
    bot.drive(snapshot, playerId, route, actions);
    sim.step([toSimInput(actions)]);
    snapshot = sim.snapshot();
    for (const mover of snapshot.entities) {
      const problem = moverProblem(mover, route);
      if (problem) problems.add(problem);
      if (mover.kind === 'vehicle') {
        trafficDirections.add(mover.road.dir);
        trafficKinds.add(mover.contentId);
      }
    }
  }
  return {
    finish: snapshot.race.finishOrder.includes(playerId),
    problems: [...problems],
    trafficDirections: [...trafficDirections],
    trafficKinds: [...trafficKinds],
    rivals: config.riders.filter((r) => r.faction === 'rider' && r.controller.kind !== 'player').length,
    localLaw: config.riders.some((r) => r.contentId === 'region-clinton:officer-rook'),
    ticks: sim.tick,
  };
}

it('the Clinton course can finish through the real loader with competitors and both traffic directions', () => {
  const found = firstSeed('Clinton course finish', [1, 2, 3, 4], race, (r) => r.finish);
  for (const attempt of found.tried) expect(attempt.result.problems).toEqual([]);
  expect(found.result, found.summary).not.toBeNull();
  if (!found.result) return;
  expect(found.result.rivals).toBeGreaterThanOrEqual(3);
  expect(found.result.localLaw).toBe(true);
  expect(found.result.trafficDirections.sort()).toEqual([-1, 1]);
  expect(found.result.trafficKinds.length).toBeGreaterThan(0);
  process.stdout.write(
    `[examined] Clinton seed ${found.seed}: finish at tick ${found.result.ticks}; ` +
      `${found.result.rivals} rivals; traffic ${found.result.trafficKinds.join(', ')} in both directions\n`,
  );
}, 120_000);
