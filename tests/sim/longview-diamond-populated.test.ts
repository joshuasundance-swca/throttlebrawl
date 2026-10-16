/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { buildSimConfig } from '../../src/app/config';
import { quickPlayEvent, quickPlaySetup } from '../../src/app/quick-play-events';
import { createStreamCache } from '../../src/app/regions';
import { registryFromGlob } from '../../src/content';
import { blankActions, botInput, createBot, SHORTCUT_APPROACH_M } from '../../src/dev/bot';
import { moverProblem } from '../../src/dev/handle/checks';
import { DEFAULT_SETTINGS, DEFAULT_RACE_OPTIONS, DEFAULT_PROFILE, settingsAssists } from '../../src/save';
import { createSimWithWorld } from '../../src/sim/create';
import { MAX_RACE_TICKS, raceState } from '../../src/sim/race';
import type { SimInput } from '../../src/sim/types';
import { firstSeed } from './batch';

const reg = registryFromGlob(import.meta.glob('/packs/*/**/*.json', { eager: true, import: 'default' }));
const route = 'region-pnw:osm-longview-street-diamond';
const eventId = quickPlayEvent(reg, 'region-pnw:pacific-northwest', 'race')!.eventId;
const config = (seed: number) =>
  buildSimConfig(reg, createStreamCache().forEvent(reg, eventId, undefined, route), {
    seed,
    eventId,
    route,
    length: DEFAULT_SETTINGS.raceLength,
    ...quickPlaySetup(
      reg,
      eventId,
      { ...DEFAULT_RACE_OPTIONS, bike: 'base:moped', rivals: 0, cops: false, traffic: 'usual' },
      DEFAULT_PROFILE.bikes,
      DEFAULT_SETTINGS.quickPlayField ?? 'open',
      seed,
      DEFAULT_SETTINGS.difficulty,
      {},
    ),
    difficulty: DEFAULT_SETTINGS.difficulty,
    assists: [settingsAssists(DEFAULT_SETTINGS)],
    speedMultiplier: DEFAULT_SETTINGS.speedMultiplier,
    slowMo: DEFAULT_SETTINGS.slowMo,
  });

function ride(seed: number, choice: 'outer' | 'inner') {
  const c = config(seed);
  const { sim, world } = createSimWithWorld(c);
  const player = sim.snapshot().entities.find((e) => e.slot === 0)!.id;
  const bot = createBot();
  const navigation = choice === 'outer' ? c.route : { ...c.route, shortcuts: [] };
  const branch = c.route.branches.find((b) => b.choice !== null)!;
  const outerStreets = branch.edges.filter((e) => !c.road.edges[e]!.isConnector);
  const visited = new Set<number>();
  const inputs: SimInput[] = [];
  const hashes: number[] = [];
  const events: Record<string, number> = {};
  const contacts: Record<string, number> = {};
  let invalid: string | null = null;
  let entered = false;
  let rejoined = false;
  let population = 0;
  let queued = false;
  let snap = sim.snapshot();
  while (!sim.isOver() && sim.tick < MAX_RACE_TICKS) {
    const actions = blankActions();
    bot.drive(snap, player, navigation, actions);
    const input = botInput(actions);
    inputs.push(input);
    sim.step([input]);
    snap = sim.snapshot();
    for (const m of snap.entities) invalid ??= moverProblem(m, c.route);
    const me = snap.entities[player]!;
    const zone = branch.choice!;
    if (
      me.road.edge === zone.edge &&
      me.road.s >= zone.s0 - SHORTCUT_APPROACH_M &&
      me.road.s <= zone.s1 &&
      me.speed < 1
    )
      queued ||= snap.entities.some(
        (m) =>
          m.kind === 'vehicle' &&
          m.road.edge === me.road.edge &&
          m.road.dir === me.road.dir &&
          m.road.s > me.road.s &&
          m.road.s <= zone.s1 &&
          m.speed < 0.5,
      );
    visited.add(me.road.edge);
    if (branch.edges.includes(me.road.edge)) entered = true;
    if (entered && c.route.mainEdges.includes(me.road.edge) && !me.finished) rejoined = true;
    population = Math.max(population, snap.entities.filter((m) => m.kind === 'vehicle').length);
    for (const event of sim.events()) {
      if (event.actor !== player) continue;
      events[event.type] = (events[event.type] ?? 0) + 1;
      if (
        (event.type === 'crash' || event.type === 'wobble') &&
        snap.entities[event.target ?? -1]?.kind === 'vehicle'
      )
        contacts[event.type] = (contacts[event.type] ?? 0) + 1;
    }
    if (sim.tick % 120 === 0) hashes.push(sim.hash());
  }
  return {
    c,
    sim,
    world,
    player,
    branch,
    outerStreets,
    visited,
    inputs,
    hashes,
    events,
    contacts,
    invalid,
    entered,
    rejoined,
    population,
    queued,
    snap,
  };
}

describe('populated Longview diamond Quick Play liveness', () => {
  it.each(['outer', 'inner'] as const)(
    'rides the %s path, rejoins and finishes with usual traffic, then replays',
    (choice) => {
      // Seed 1 is the deployed incident. Find the natural stopped-queue precondition, never a
      // successful finish; the selected race must then satisfy all ride and replay assertions.
      const search =
        choice === 'outer'
          ? firstSeed(
              'Longview outer stopped approach queue',
              [1, 2, 3, 4],
              (seed) => ride(seed, choice),
              (r) => r.queued,
            )
          : { result: ride(1, choice), summary: 'inner-path control, incident seed 1' };
      expect(search.result, search.summary).not.toBeNull();
      const {
        c,
        sim,
        world,
        player,
        outerStreets,
        visited,
        inputs,
        hashes,
        events,
        contacts,
        invalid,
        entered,
        rejoined,
        population,
        snap,
      } = search.result!;
      expect(invalid).toBeNull();
      expect(population, 'the ordinary traffic catalog populates the race').toBeGreaterThan(0);
      expect(entered).toBe(choice === 'outer');
      if (choice === 'outer') {
        expect(outerStreets.length).toBeGreaterThan(0);
        for (const edge of outerStreets) expect(visited.has(edge), c.road.edges[edge]!.id).toBe(true);
        expect(rejoined, 'returns to the shared main path before finishing').toBe(true);
      }
      const me = snap.entities[player]!;
      expect(me.road.edge).toBe(c.route.finish.edge);
      expect(me.road.s).toBeGreaterThanOrEqual(c.route.finish.s);
      expect(snap.race.finishOrder).toContain(player);
      expect(raceState(world).checkpoint[player]).toBe(c.route.checkpoints.length);
      const replay = createSimWithWorld(config(c.seed)).sim;
      const replayHashes: number[] = [];
      for (const input of inputs) {
        replay.step([input]);
        if (replay.tick % 120 === 0) replayHashes.push(replay.hash());
      }
      expect(replayHashes).toEqual(hashes);
      expect(replay.hash()).toBe(sim.hash());
      process.stdout.write(
        `[examined] populated moped ${choice}: ${sim.tick} finish ticks, ${hashes.length} replay hashes, max ${population} vehicles, events ${JSON.stringify(events)}, vehicle contacts ${JSON.stringify(contacts)}, visited ${[...visited].map((e) => c.road.edges[e]!.id).join(', ')}\n`,
      );
    },
    180000,
  );
});
