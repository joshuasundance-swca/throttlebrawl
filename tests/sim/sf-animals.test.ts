/// <reference types="vite/client" />
// San Francisco's animals stand where the joke fits (playtest 4, run B's live check, punch item 7: "Sea lions
// and doodles appear at every SF zone: Twin Peaks, Lombard and the Mission. `sea-lion.json` intends the joke,
// but it works against place identity"; the identity sheets' C8). The region's default animals, a sea lion and
// a doodle, were the stray of every zone that named no kinds of its own. The rule, read from what a race
// spawns: a sea lion is on the waterfront and its piers only (a zone of the `sf-wf-*` roads and the pier row);
// a doodle stands in a neighbourhood, never at a summit, a lookout or on the Lombard block, where the zone's
// own people are the point; and the controls: the probe finds both kinds where they belong, on the real
// routes and seeds (a probe that cannot find a doodle proves nothing about where one is not).
import { describe, expect, it } from 'vitest';
import { buildSimConfig, createStreamCache } from '../../src/app';
import { registryFromGlob } from '../../src/content';
import { createSim } from '../../src/sim/api';

const REG = registryFromGlob(
  import.meta.glob<unknown>('/packs/*/**/*.json', { eager: true, import: 'default' }),
);
const STREAMS = createStreamCache();
const EVENT = 'region-sf:sf-hill-sprint';
const print = (line: string) => process.stdout.write(`[sf-animals] ${line}\n`);

/** Every route of the region's real and hand-made roads, qualified. */
const ROUTES = [
  'osm-sf-hills-run',
  'osm-sf-lombard-run',
  'osm-sf-twin-peaks-run',
  'osm-sf-golden-gate-run',
  'sf-chinatown-northbeach-run',
  'sf-downtown-run',
  'sf-mission-run',
  'sf-standard-run',
  'sf-waterfront-run',
].map((r) => `region-sf:${r}`);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

/** A zone's road is the waterfront's: a sf-wf-* road or the pier row. */
const waterfrontRoad = (id: string) => /^sf-wf-/.test(id) || id === 'sf-pier-row';
/**
 * The places where a stray animal works against the place (a summit, a lookout, the Lombard block): by zone id,
 * whatever road it is on, so a zone moved to another road keeps its ruling.
 */
const SCENIC = new Set(['summit-lookout', 'hawk-hill-overlook', 'lombard-top', 'lombard-bottom']);

interface Animal {
  seed: number;
  route: string;
  road: string;
  zone: string;
  kind: string;
}

/** Every animal standing in a zone at the start of a race on each route and seed, with the zone it stands in. */
function animals(): { animals: Animal[]; zones: Set<string> } {
  const out: Animal[] = [];
  const zones = new Set<string>();
  for (const route of ROUTES)
    for (const seed of SEEDS) {
      const config = buildSimConfig(REG, STREAMS.forEvent(REG, EVENT, undefined, route), {
        seed,
        eventId: EVENT,
        route,
      });
      const snap = createSim(config).snapshot();
      const zoneAt = (edge: number, s: number) =>
        config.road.featuresOf(edge, 'roadsideZone').find((f) => s >= f.s0 - 1 && s <= f.s1 + 1);
      for (const f of config.road.edges.flatMap((e) => config.road.featuresOf(e.index, 'roadsideZone')))
        zones.add(f.id);
      for (const e of snap.entities) {
        if (e.kind !== 'ped' || !e.contentId) continue;
        const type = config.trafficTypes.find((t) => t.contentId === e.contentId);
        if (type?.category !== 'animal') continue;
        const zone = zoneAt(e.road.edge, e.road.s);
        out.push({
          seed,
          route,
          road: config.road.edges[e.road.edge]?.id ?? '?',
          zone: zone?.id ?? '?',
          kind: e.contentId.slice(e.contentId.indexOf(':') + 1),
        });
      }
    }
  return { animals: out, zones };
}

describe('San Francisco animals stand where the joke fits', () => {
  const { animals: seen, zones } = animals();
  const tally = (list: readonly Animal[]) => {
    const t: Record<string, number> = {};
    for (const a of list) t[a.kind] = (t[a.kind] ?? 0) + 1;
    return JSON.stringify(t);
  };

  it('the probe finds animals, and finds them in zones (not on the road)', () => {
    print(`${ROUTES.length} routes x ${SEEDS.length} seeds: ${seen.length} animals standing, ${tally(seen)}`);
    expect(seen.length).toBeGreaterThan(20);
    expect(seen.filter((a) => a.zone === '?').length).toBe(0);
    // The scenic zones the rule names exist in the packs (a renamed zone must not silently lose its ruling).
    for (const z of SCENIC) expect(zones.has(z), z).toBe(true);
  });

  it('puts sea lions on the waterfront and its piers only', () => {
    const lions = seen.filter((a) => a.kind === 'sea-lion');
    const wrong = lions.filter((a) => !waterfrontRoad(a.road));
    print(
      `sea lions: ${lions.length} in all, ${wrong.length} off the waterfront (${[...new Set(wrong.map((a) => a.zone))].join(', ')})`,
    );
    // The control: they are on the waterfront (the joke is kept), on more than one road of it.
    const home = lions.filter((a) => waterfrontRoad(a.road));
    expect(home.length, 'sea lions on the waterfront').toBeGreaterThan(5);
    expect(new Set(home.map((a) => a.road)).size, 'waterfront roads with a sea lion').toBeGreaterThan(2);
    expect(wrong.map((a) => `${a.zone} on ${a.road}`).slice(0, 6)).toEqual([]);
  });

  it('keeps doodles to the neighbourhoods: none at a summit, a lookout or the Lombard block', () => {
    const dogs = seen.filter((a) => a.kind === 'doodle');
    const scenic = seen.filter((a) => SCENIC.has(a.zone));
    print(`doodles: ${dogs.length} in all; animals in the scenic zones: ${scenic.length}`);
    // The control: doodles do stand in the neighbourhoods (the joke is kept), in more than three zones.
    const home = dogs.filter((a) => !SCENIC.has(a.zone));
    expect(home.length, 'doodles in the neighbourhoods').toBeGreaterThan(8);
    expect(new Set(home.map((a) => a.zone)).size, 'neighbourhood zones with a doodle').toBeGreaterThan(3);
    expect(scenic.map((a) => `${a.kind} at ${a.zone}`).slice(0, 6)).toEqual([]);
  });
});
