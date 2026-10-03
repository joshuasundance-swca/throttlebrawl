/// <reference types="vite/client" />
// (The reference gives this Node-side program the Vite types, import.meta.glob, that the app's
// content loader uses.)
//
// Run W-R, each key its own traffic (interview, 2026-10-02: "KEYS FIRST = DISTINCT KEYS: a fishing
// village, a resort strip, a junkyard key, a party key"). The bot rides the long haul over all four
// keys on the base pack, with the full field, traffic and pedestrians, and every key's own vehicles
// turn up on that key and nowhere else: shrimp trucks by the fishing village, rental scooters on the
// resort strip, wreckers and the shuttle bus on the junkyard key, party vans and coolers on wheels
// on the party key. The bot still finishes.
import { describe, expect, it } from 'vitest';
import { buildSimConfig, DEFAULT_EVENT } from '../../src/app';
import { loadBasePack, lookup } from '../../src/content';
import { createBot } from '../../src/dev';
import { emptyActions, toSimInput } from '../../src/input';
import { createSim, type SimConfig } from '../../src/sim/api';
import { activateRegion } from '../../src/stream';

/** Each key's own vehicles (in no region mix), by the district tag of the key they belong on. */
const OWN: Readonly<Record<string, string>> = {
  'base:shrimp-truck': 'key-fishing',
  'base:resort-scooter-rider': 'key-resort',
  'base:salvage-wrecker': 'key-junkyard',
  'base:salvage-key-shuttle': 'key-junkyard',
  'base:party-van': 'key-party',
  'base:cooler-on-wheels': 'key-party',
};
const KEYS = ['key-fishing', 'key-resort', 'key-junkyard', 'key-party'];
// Seed 10 joined when branch riders over the main road started touching its traffic (run W-U fixes'
// re-check): seeds 3 and 8 then met no junkyard shuttle (main: 6 and 2). That is the dice, not the
// areas: over seeds 1 to 20 the fixed sim met 51 shuttles, every seed but 3, 5 and 8 at least one,
// against 21 in seeds 1 to 8 before (2.6 a race either way).
const SEEDS = [3, 8, 10];
const MAX_TICKS = 60 * 60 * 12;

interface Sighting {
  type: string;
  key: string | null;
}

function longHaul(seed: number) {
  const reg = loadBasePack();
  const routeFile = lookup(reg.routes, 'm1-long-haul');
  const network = lookup(reg.networks, routeFile.network);
  const stream = activateRegion({ network, roads: network.roads.map((id) => lookup(reg.roads, id)) });
  const built = buildSimConfig(reg, stream, { seed, eventId: DEFAULT_EVENT });
  // No cop: the dev bot never evades the law (as tests/sim/road-lengths does).
  const config: SimConfig = {
    ...built,
    riders: built.riders.filter((r) => r.faction !== 'law'),
    event: { ...built.event, routeId: 'base:m1-long-haul' },
    route: stream.routeFor(routeFile),
  };
  const sim = createSim(config);
  const playerId = config.riders.findIndex((r) => r.controller.kind === 'player');
  const bot = createBot();
  const keyAt = (edge: number, s: number): string | null =>
    config.road.edges[edge]?.tags.find((t) => KEYS.includes(t.tag) && s >= t.s0 && s <= t.s1)?.tag ?? null;
  // Each vehicle where it is first seen (a slot reused for a new vehicle is seen again).
  const seen = new Map<number, string>();
  const sightings: Sighting[] = [];
  let snap = sim.snapshot();
  let finishTick = -1;
  while (!sim.isOver() && sim.tick < MAX_TICKS) {
    const actions = emptyActions();
    bot.drive(snap, playerId, config.route, actions);
    sim.step([toSimInput(actions)]);
    snap = sim.snapshot();
    for (const e of snap.entities) {
      if (e.kind !== 'vehicle') continue;
      const id = e.contentId ?? '';
      if (seen.get(e.id) === id) continue;
      seen.set(e.id, id);
      sightings.push({ type: id, key: keyAt(e.road.edge, e.road.s) });
    }
    if (finishTick < 0 && snap.race.finishOrder.includes(playerId)) finishTick = sim.tick;
  }
  return { sightings, finishTick, seed };
}

describe('W-R: each key its own traffic, on the long haul', () => {
  it("meets every key's own vehicles on that key only, and the bot still finishes", () => {
    const runs = SEEDS.map(longHaul);
    const all = runs.flatMap((r) => r.sightings);
    for (const r of runs) expect(r.finishTick, `seed ${r.seed}: the bot finished`).toBeGreaterThan(0);
    const count = (type: string) => all.filter((s) => s.type === type).length;
    const report = Object.keys(OWN)
      .map((t) => `${t.slice(5)} ${count(t)}`)
      .join(', ');
    console.log(`[examined] ${all.length} vehicle sightings over seeds ${SEEDS.join(', ')}: ${report}`);
    // Each key's own vehicles turn up...
    for (const type of Object.keys(OWN)) expect(count(type), type).toBeGreaterThan(0);
    // ...first seen (where they spawn) on their own key, never on another key or between keys.
    const strays = all.filter((s) => OWN[s.type] !== undefined && s.key !== OWN[s.type]);
    expect(strays).toEqual([]);
  }, 240_000);
});
