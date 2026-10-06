/// <reference types="vite/client" />
// Playtest 4 (the maintainer, 2026-10-05: "I want most things on the sidewalks to jump out of the way"):
// the rule test. A scripted rider rides each region's busy city route fast up the sidewalk and verge,
// aiming at the nearest thing that lives there (tests/sim/sidewalk-ride.ts), over seeded rides.
//
// - The share of the things in the rider's way that get out of it is at least BAND overall and
//   REGION_BAND in each region. Not 100 %: a thing already lying down from an earlier dive, or caught
//   behind a wall with no room, can still be met, and a `solid` kind never moves. The bands sit well
//   under the measured share (printed below) so a different seed's ride does not flip them, and well
//   over what the same rides gave before the kerb riders learned to dodge a rider on the verge
//   (`traffic.kerbDeep` 0, printed when SIDEWALK_BEFORE=1).
// - A `dodges` kind never costs the rider a crash, wherever the rider meets it.
// - A rider who brakes is never punished: nothing steps into, or topples onto, a rider stopped beside
//   it, and a rider braking for the nearest thing is not wobbled or crashed by any of them.
import { describe, expect, it } from 'vitest';
import { roadsideClass } from '../../src/sim/roadside';
import { dodged, ride, type Thing } from './sidewalk-ride';

const print = (line: string) => process.stdout.write(line + '\n');

/** Two busy city events per region: Duval Street and the party-season road; the Embarcadero and the alleys; downtown Portland and the ferry line. */
const REGIONS: Record<string, readonly string[]> = {
  keys: ['base:keys-t1-last-light-duval', 'base:keys-t4-hurricane-party'],
  sf: ['region-sf:sf-t1-pier-pressure', 'region-sf:sf-t2-stair-alley'],
  pnw: ['region-pnw:pnw-t1-bridge-city', 'region-pnw:pnw-t1-ferry-line'],
};
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const TICKS = 4500;
const BRAKE_SEEDS = [1];
const BAND = 0.85;
const REGION_BAND = 0.75;
/** Fewest things in the way a region's rides must meet for its share to mean anything. */
const MIN_SAMPLE = 5;
const MIN_OVERALL = 30;

function share(rows: readonly Thing[]): { n: number; dodged: number } {
  const inPath = rows.filter((t) => t.inPath);
  return { n: inPath.length, dodged: inPath.filter(dodged).length };
}

describe("sidewalk things get out of a fast rider's way", () => {
  const byRegion = new Map<string, Thing[]>();
  const hits: string[] = [];

  it('rides every region up its sidewalks', () => {
    const before = process.env['SIDEWALK_BEFORE'] === '1';
    for (const [region, events] of Object.entries(REGIONS)) {
      const rows: Thing[] = [];
      const old: Thing[] = [];
      for (const eventId of events)
        for (const seed of SEEDS) {
          const r = ride({ seed, eventId, maxTicks: TICKS });
          rows.push(...r.things);
          for (const h of r.thingHits) {
            const t = r.config.trafficTypes.find((x) => x.contentId === h.thing);
            // Only a `dodges` kind is in this rule: the road's cars and a set piece's truck are `solid`.
            if (t && roadsideClass(t) === 'dodges')
              hits.push(`${region} ${eventId} seed ${seed} ${h.type} ${h.thing}`);
          }
          if (before)
            old.push(...ride({ seed, eventId, maxTicks: TICKS, tuning: { 'traffic.kerbDeep': 0 } }).things);
        }
      byRegion.set(region, rows);
      const a = share(rows);
      const types = new Map<string, { n: number; d: number; contact: number }>();
      for (const t of rows.filter((x) => x.inPath)) {
        const e = types.get(t.contentId) ?? { n: 0, d: 0, contact: 0 };
        e.n++;
        if (dodged(t)) e.d++;
        if (t.contact) e.contact++;
        types.set(t.contentId, e);
      }
      print(
        `[sidewalk] ${region}: ${a.dodged} of ${a.n} things in the way got out of it` +
          (before
            ? ` (before the kerb riders learned the verge: ${share(old).dodged} of ${share(old).n})`
            : '') +
          '; ' +
          [...types].map(([k, v]) => `${k} ${v.d}/${v.n}${v.contact ? ` hit ${v.contact}` : ''}`).join(', '),
      );
    }
  }, 900_000);

  it('at least the band of them dodge, overall and in each region', () => {
    let n = 0;
    let d = 0;
    for (const [region, rows] of byRegion) {
      const s = share(rows);
      expect(s.n, `${region} sample`).toBeGreaterThanOrEqual(MIN_SAMPLE);
      expect(s.dodged / s.n, `${region} share`).toBeGreaterThanOrEqual(REGION_BAND);
      n += s.n;
      d += s.dodged;
    }
    print(`[sidewalk] overall ${d} of ${n} (${((100 * d) / n).toFixed(0)} %), band ${BAND * 100} %`);
    expect(n, 'overall sample').toBeGreaterThanOrEqual(MIN_OVERALL);
    expect(d / n).toBeGreaterThanOrEqual(BAND);
  });

  it('a `dodges` kind never costs the rider a crash', () => {
    const crashes = hits.filter((h) => h.includes('crash'));
    print(`[sidewalk] rider crashes into things over the rides: ${crashes.length} ${crashes.join('; ')}`);
    expect(crashes).toEqual([]);
  });

  it('a rider who brakes is never punished', () => {
    const lines: string[] = [];
    let rides = 0;
    for (const events of Object.values(REGIONS))
      for (const eventId of events)
        for (const seed of BRAKE_SEEDS) {
          const r = ride({ seed, eventId, maxTicks: TICKS, brakeAtM: 25 });
          rides++;
          // Nothing hit the braking rider, and nothing touched it once it was still.
          for (const h of r.thingHits) {
            const t = r.config.trafficTypes.find((x) => x.contentId === h.thing);
            if (t && roadsideClass(t) !== 'solid') lines.push(`${eventId} seed ${seed} ${h.type} ${h.thing}`);
          }
        }
    print(`[sidewalk] ${rides} braking rides: ${lines.length} punishments ${lines.join('; ')}`);
    expect(lines).toEqual([]);
  }, 900_000);
});
