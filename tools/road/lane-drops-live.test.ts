import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createRoadNetwork,
  fixtureNetwork,
  highwayLanes,
  type RoadNetwork,
  type RoadPos,
} from '../../src/road';
import type { BakedNetwork, BakedRoad } from '../../src/road/types';
import { barrierLimits } from '../../src/sim/riders';
import { funnelLimits } from '../../src/sim/riders/funnel';
import type { SimConfig } from '../../src/sim/types';

// Lane drops on the live roads (W-R multi-lane highways): the riders' funnel (sim/riders/funnel.ts)
// exists only where the road's width changes. On every live network it is checked every 10 m, both
// ways along every road against the actual lane-section and join boundaries ahead. Named controls
// include San Francisco's freeway, riding back toward the city (the freeway widens the way the
// race goes), and since run W-S in Key West, where four-lane South
// Roosevelt Boulevard narrows into two-lane Bertha Street the way the race goes (the first drop a
// racer meets), and at both ends of North Roosevelt Boulevard, the four-lane junction choice, which
// narrows into 1st Street ahead and into its one-lane turn-off behind.
// The truck shortcuts also narrow from their 8 m yards into 3.5 m exits, and riding backward
// onto their streets brings the mapped right edge in. All four are checked against their data.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

function networks(): { network: BakedNetwork; roads: BakedRoad[] }[] {
  const out: { network: BakedNetwork; roads: BakedRoad[] }[] = [];
  for (const pack of readdirSync(path.join(root, 'packs'))) {
    const regions = path.join(root, 'packs', pack, 'regions');
    if (!existsSync(regions)) continue;
    for (const region of readdirSync(regions)) {
      const dir = (sub: string) => path.join(regions, region, sub);
      const list = <T>(sub: string) =>
        existsSync(dir(sub))
          ? readdirSync(dir(sub))
              .filter((f) => f.endsWith('.json'))
              .map((f) => json<T>(path.join(dir(sub), f)))
          : [];
      const roads = list<BakedRoad>('roads');
      for (const network of list<BakedNetwork>('networks')) {
        const mine = new Set(network.roads);
        out.push({ network, roads: roads.filter((r) => mine.has(r.id)) });
      }
    }
  }
  return out;
}

type Bounds = { lo: number; hi: number };
type LimitsAt = (edge: number, s: number) => Bounds;
const LOOKAHEAD_M = 90;

/** Enumerate physical cross-sections at authored boundaries, rather than reproduce the funnel's
 * fixed-distance samples, change table, bisection or taper formula. Between section starts and
 * joins the lane envelope is constant. Public advance carries the image of d=0 across the joins;
 * reversing that affine mapping puts each future boundary back in the starting road's frame. */
function boundariesAhead(road: RoadNetwork, pos: RoadPos, limits: LimitsAt): Bounds[] {
  const across = (p: RoadPos): Bounds => {
    const band = limits(p.edge, p.s);
    const sign = p.dir * pos.dir;
    const corners = [band.lo, band.hi].map((d) => sign * (d - p.d));
    return { lo: Math.min(...corners), hi: Math.max(...corners) };
  };
  const afterBoundaryM = 1e-6;
  let p = { ...pos, d: 0 };
  let travelled = 0;
  const out = [across(p)];
  while (travelled < LOOKAHEAD_M) {
    const edge = road.edges[p.edge]!;
    const toEnd = p.dir === 1 ? edge.length - p.s : p.s;
    const reach = Math.min(toEnd, LOOKAHEAD_M - travelled);
    for (const section of edge.sections) {
      const distance = (section.s0 - p.s) * p.dir;
      if (distance < 0 || distance + afterBoundaryM > reach) continue;
      const s = section.s0 + p.dir * afterBoundaryM;
      if (s >= 0 && s <= edge.length) out.push(across({ ...p, s }));
    }
    out.push(across({ ...p, s: p.s + p.dir * reach }));
    if (travelled + reach >= LOOKAHEAD_M) break;
    const next = { ...p, s: p.dir === 1 ? edge.length + afterBoundaryM : -afterBoundaryM };
    if (road.advance(next) === 'deadEnd') break;
    travelled += toEnd + afterBoundaryM;
    p = next;
    out.push(across(p));
  }
  return out;
}

describe('lane drops on the live roads (W-R)', () => {
  it('the boundary oracle distinguishes a drop from a constant road or a widening', () => {
    const road = createRoadNetwork(
      fixtureNetwork([
        { id: 'wide', lengthM: 200, kappa: 0, lanes: highwayLanes(3) },
        { id: 'narrow', lengthM: 200, kappa: 0 },
      ]),
    );
    const config = { road } as SimConfig;
    const limits = (edge: number, s: number) => barrierLimits(config, edge, s);
    for (const pos of [
      { edge: 0, s: 150, d: 0, dir: 1 as const }, // a real narrowing ahead
      { edge: 0, s: 50, d: 0, dir: 1 as const }, // same width throughout the lookahead
      { edge: 1, s: 50, d: 0, dir: -1 as const }, // a widening ahead
    ]) {
      const now = limits(pos.edge, pos.s);
      const ahead = boundariesAhead(road, pos, limits);
      const inward = ahead.some((b) => b.lo > now.lo || b.hi < now.hi);
      expect(inward).toBe(pos.edge === 0 && pos.s === 150);
      expect(funnelLimits(road, LOOKAHEAD_M, pos, limits) !== null).toBe(inward);
    }
  });

  it('the funnel appears only where a live road narrows, including the truck shortcut interfaces', () => {
    const found = new Map<string, number>();
    const shortcutStations = new Map<string, number[]>();
    const cuts = new Set(['pnw-mill-yard-cut', 'sf-dt-plaza-cut']);
    let stations = 0;
    let noNarrowingStations = 0;
    for (const n of networks()) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      const config = { road } as SimConfig;
      const limits = (edge: number, s: number) => barrierLimits(config, edge, s);
      for (const e of road.edges) {
        if (cuts.has(e.id)) {
          const extent = (edge: number, s: number) => {
            const lanes = road.lanesAt(edge, s);
            return [
              Math.min(...lanes.map((l) => l.dCenterM - l.widthM / 2)),
              Math.max(...lanes.map((l) => l.dCenterM + l.widthM / 2)),
            ];
          };
          expect(extent(e.index, 0), `${e.id}: the actual yard`).toEqual([1, 9]);
          expect(road.lanesAt(e.index, 0).map(({ widthM, direction }) => ({ widthM, direction }))).toEqual([
            { widthM: 8, direction: 1 },
          ]);
          expect(e.next).not.toBeNull();
          expect(extent(e.next!.edge, 0), `${e.id}: single-bike exit`).toEqual([1, 4.5]);
          expect(
            road.lanesAt(e.next!.edge, 0).map(({ widthM, direction }) => ({ widthM, direction })),
          ).toEqual([{ widthM: 3.5, direction: 1 }]);
          // Source-derived reverse narrowing: the street's right edge, mapped into this yard.
          const back = { edge: e.index, s: -90, d: 0, dir: -1 as const };
          expect(road.advance(back)).not.toBe('deadEnd');
          expect(back.dir).toBe(-1);
          expect(extent(back.edge, back.s)[1]! - back.d).toBeLessThan(9);
        }
        for (let s = 0; s <= e.length; s += 10) {
          for (const dir of [1, -1] as const) {
            stations++;
            const pos = { edge: e.index, s, d: 0, dir };
            const now = limits(e.index, s);
            const ahead = boundariesAhead(road, pos, limits);
            const innermost = {
              lo: Math.max(...ahead.map((b) => b.lo)),
              hi: Math.min(...ahead.map((b) => b.hi)),
            };
            const f = funnelLimits(road, LOOKAHEAD_M, pos, limits);
            const key = `${e.id} dir ${dir}`;
            if (innermost.lo <= now.lo && innermost.hi >= now.hi) {
              noNarrowingStations++;
              expect(f, `${key} at ${s}: no physical inward boundary ahead`).toBeNull();
            }
            if (f) {
              expect(f.lo, `${key} at ${s}: never move the left edge outward`).toBeGreaterThanOrEqual(now.lo);
              expect(f.hi, `${key} at ${s}: never move the right edge outward`).toBeLessThanOrEqual(now.hi);
              expect(f.lo > now.lo || f.hi < now.hi, `${key} at ${s}: actually narrows`).toBe(true);
              if (f.lo > now.lo) {
                expect(innermost.lo, `${key} at ${s}: physical left boundary ahead`).toBeGreaterThan(now.lo);
                expect(f.lo).toBeLessThanOrEqual(innermost.lo + 1e-9);
              }
              if (f.hi < now.hi) {
                expect(innermost.hi, `${key} at ${s}: physical right boundary ahead`).toBeLessThan(now.hi);
                expect(f.hi).toBeGreaterThanOrEqual(innermost.hi - 1e-9);
              }
              found.set(key, (found.get(key) ?? 0) + 1);
              if (cuts.has(e.id)) {
                const stations = shortcutStations.get(key) ?? [];
                stations.push(s);
                shortcutStations.set(key, stations);
                // The real right lane edge must narrow within the 90 m lookahead, mapped
                // back through the actual default connector path (including d shifts).
                const narrowHi = innermost.hi;
                expect(narrowHi, `${key} at ${s}: a real narrower edge ahead`).toBeLessThan(8.5);
                expect(f.hi).toBeLessThan(8.5);
                expect(f.hi).toBeGreaterThanOrEqual(narrowHi - 1e-9);
              }
            }
          }
        }
      }
    }
    process.stdout.write(
      `[examined] ${stations} stations, ${noNarrowingStations} no-narrowing controls; funnels: ${JSON.stringify([...found])}\n`,
    );
    expect(stations).toBeGreaterThan(5000);
    expect(noNarrowingStations).toBeGreaterThan(0);
    // Riding back, the freeway narrows twice on its own first 160 m (three lanes to two, then two to
    // the on-ramp's one). Key West's drops are one each, the funnel's 90 m taper (9 stations).
    // Playtest 3's two SF bakes add three on purpose (T9.3): the Golden Gate's bridge narrows riding
    // back (its three oncoming lanes meet Vista Point's ramp, which has one), and Lombard's two-way
    // streets meet the one-lane, one-way crooked block (riding forward on the climb, and in the
    // oncoming lane on the flats). The Seven Mile's old road (playtest 3, T9.2) narrows from its two
    // lanes to the one-lane repair platforms (`osm-sm-old-road`, `osm-sm-old-road-back`) at both of
    // them.
    // Named positive regressions, not an inventory of every place allowed to narrow. New content
    // is covered above by the physical-boundary invariant and needs no addition to this list.
    for (const key of [
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
      'osm-sf-gg-bridge dir -1',
      'osm-sf-lombard-climb dir 1',
      'osm-sf-lombard-flats dir -1',
      'osm-sm-old-east dir -1',
      'osm-sm-old-road dir -1',
      'osm-sm-old-west dir 1',
      'pnw-mill-yard-cut dir -1',
      'pnw-mill-yard-cut dir 1',
      'sf-bridge-approach dir -1',
      'sf-dt-plaza-cut dir -1',
      'sf-dt-plaza-cut dir 1',
    ])
      expect(found.get(key), `${key}: named positive regression`).toBeGreaterThan(0);
    expect(shortcutStations.size).toBe(4);
    for (const [key, samples] of shortcutStations) {
      expect(samples.length, key).toBeLessThanOrEqual(10);
      expect(Math.max(...samples) - Math.min(...samples), `${key}: bounded taper`).toBeLessThanOrEqual(90);
    }
    expect(found.get('sf-bridge-approach dir -1')).toBeLessThanOrEqual(18);
    for (const k of [
      'osm-kw-north-roosevelt dir -1',
      'osm-kw-north-roosevelt dir 1',
      'osm-kw-smathers-beach dir 1',
      'osm-sm-old-east dir -1',
      'osm-sm-old-road dir -1',
      'osm-sm-old-west dir 1',
    ])
      expect(found.get(k), k).toBeLessThanOrEqual(10);
  });
});
