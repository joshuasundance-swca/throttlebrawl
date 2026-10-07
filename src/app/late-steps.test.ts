/// <reference types="vite/client" />
// The sim's step, a lazy chunk (lane U3, 2026-10-07: the first-load headroom; src/sim/late.ts). Each system's
// step and the rules only it reaches load after the first screen, with the structures' planners, and a race
// waits for them. The menu's grid (the attract scene: a sim made and snapshotted, never stepped) needs none of
// it. These run in a fresh module graph, where nothing has loaded the step yet (the Vitest setup loads it for
// every other test, as the app loads it before any race).
import { describe, expect, it, vi } from 'vitest';
import { registryFromGlob } from '../content';
import { createSim } from '../sim/api';
import { buildSimConfig } from './config';
import { createStreamCache } from './regions';

const FILES = import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' });

/** The sim's and the app's race-building modules, fresh: the step chunk not loaded. */
async function freshGraph() {
  vi.resetModules();
  const [api, config, regions, content] = await Promise.all([
    import('../sim/api'),
    import('./config'),
    import('./regions'),
    import('../content'),
  ]);
  return { api, config, regions, reg: content.registryFromGlob(FILES) };
}

describe('the sim step loads late', () => {
  it('makes and snapshots every event’s grid without it, and refuses to step until it has loaded', async () => {
    const { api, config, regions, reg } = await freshGraph();
    const streams = regions.createStreamCache();
    const events = Object.keys(reg.events);
    let grids = 0;
    for (const eventId of events) {
      const stream = streams.forEvent(reg, eventId);
      for (const seed of [1, 2]) {
        const sim = api.createSim(config.buildSimConfig(reg, stream, { seed, eventId }));
        expect(sim.snapshot().entities.length).toBeGreaterThan(0);
        grids++;
      }
    }
    console.log(
      `[examined] ${grids} grids (${events.length} events x 2 seeds) made and snapshotted with no step code`,
    );
    expect(events.length).toBeGreaterThan(20);

    // The negative control: the same sim refuses to step before the chunk is in, rather than step without it.
    const first = events[0] ?? '';
    const sim = api.createSim(
      config.buildSimConfig(reg, streams.forEvent(reg, first), { seed: 1, eventId: first }),
    );
    expect(() => sim.step([])).toThrow(/step has not loaded/);
  });

  it('steps exactly as the sim the setup loaded once it has loaded', async () => {
    const reg = registryFromGlob(FILES);
    const eventId = Object.keys(reg.events)[0] ?? '';
    const loaded = createSim(
      buildSimConfig(reg, createStreamCache().forEvent(reg, eventId), { seed: 7, eventId }),
    );
    const fresh = await freshGraph();
    await Promise.all([fresh.api.loadSimSteps(), fresh.api.loadStructurePlanners()]);
    const late = fresh.api.createSim(
      fresh.config.buildSimConfig(fresh.reg, fresh.regions.createStreamCache().forEvent(fresh.reg, eventId), {
        seed: 7,
        eventId,
      }),
    );
    for (let t = 0; t < 600; t++) {
      loaded.step([]);
      late.step([]);
    }
    console.log(`[examined] ${eventId} seed 7, 600 ticks: hash ${loaded.hash()} and ${late.hash()}`);
    expect(late.hash()).toBe(loaded.hash());
    expect(late.tick).toBe(600);
  });
});
