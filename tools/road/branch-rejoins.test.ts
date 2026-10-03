import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LaneInfo } from '../../src/core';
import { createRoadNetwork, createRouteProgress } from '../../src/road';
import type { BakedNetwork, BakedRoad, BakedRoute } from '../../src/road/types';
import { BIKE_HALF_WIDTH_M } from '../../src/sim/riders';

// Run W-U's live check, mustFix 1: the Mangrove Boardwalk rejoined the Mangrove Reach at d -3, the
// middle of the ONCOMING lane, so a rider came off the planks at race speed head-on into the Keys'
// shuttles (4 traffic crashes in 8 exits, against 1 in 53 on the main road through the same
// junction). The sandbar's exit onto Conch Row had the same shape (d -3). This checks every branch
// rejoin on every live network, hand-made and map-data alike: where a rider leaves a branch road
// onto a road of the route, the middle of the branch's travel lanes lands in a travel lane running
// the rider's way, and no d a rider's centre can hold on the branch lands deeper in an oncoming lane
// than half a bike (wheels on the centre line, as anywhere on a two-way road). The map-data rejoins
// (tbgis, Key West's Boulevard and Russian Hill's Jones) land their 6 m connector at d 2, so a rider
// hugging the connector's far-left edge lands with its centre 0.5 m past the line: that is the edge
// of the rule, not the boardwalk's fault (its whole width landed in the oncoming lane).
const ONCOMING_SLACK_M = BIKE_HALF_WIDTH_M + 1e-3;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = <T>(file: string) => JSON.parse(readFileSync(file, 'utf8')) as T;

interface Live {
  network: BakedNetwork;
  roads: BakedRoad[];
  routes: BakedRoute[];
}

function live(): Live[] {
  const out: Live[] = [];
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
      const routes = list<BakedRoute>('routes');
      for (const network of list<BakedNetwork>('networks')) {
        const mine = new Set(network.roads);
        out.push({
          network,
          roads: roads.filter((r) => mine.has(r.id)),
          routes: routes.filter((r) => r.network === network.id),
        });
      }
    }
  }
  return out;
}

/** The lanes a rider travelling `dir` along s rides: drive or shortcut lanes running that way. */
const travelLanes = (lanes: readonly LaneInfo[], dir: number) =>
  lanes.filter((l) => l.direction === dir && (l.kind === 'drive' || l.kind === 'shortcut'));

describe('branch rejoins land in the travel lanes, on every live network', () => {
  it('no rider leaves a branch into a lane of oncoming traffic', () => {
    const lines: string[] = [];
    const faults: string[] = [];
    let rejoins = 0;
    let routes = 0;
    for (const n of live()) {
      const road = createRoadNetwork({ network: n.network, roads: n.roads });
      for (const r of n.routes) {
        const route = createRouteProgress(road, r);
        routes++;
        const main = new Set(route.mainEdges);
        const seen = new Set<string>();
        for (const b of route.branches) {
          for (const e of b.edges) {
            const o = route.orientation(e);
            const edge = road.edges[e];
            if (o === 0 || !edge) continue;
            const exitEnd = o === 1 ? 'to' : 'from';
            const sExit = exitEnd === 'to' ? edge.length : 0;
            // Where the rider's centre can be on the branch at its exit (the bike stays inside its lanes).
            const own = travelLanes(road.lanesAt(e, sExit), o);
            if (own.length === 0) continue;
            const lo = Math.min(...own.map((l) => l.dCenterM - l.widthM / 2)) + BIKE_HALF_WIDTH_M;
            const hi = Math.max(...own.map((l) => l.dCenterM + l.widthM / 2)) - BIKE_HALF_WIDTH_M;
            for (const l of road.nextEdges(e, exitEnd)) {
              // A rejoin: out of the branch onto the route's main path.
              if (!main.has(l.edge)) continue;
              const far = road.edges[l.edge];
              if (!far) continue;
              const key = `${edge.id}>${far.id}`;
              if (seen.has(key)) continue;
              seen.add(key);
              rejoins++;
              // d across the join (EdgeLink.dShift): the far edge's d = σ·d + dShift.
              const sigma = l.entersAt === exitEnd ? -1 : 1;
              const ends = [sigma * lo + (l.dShift ?? 0), sigma * hi + (l.dShift ?? 0)];
              const dLo = Math.min(...ends);
              const dHi = Math.max(...ends);
              // The rider's direction along the far edge's s, and the lanes coming the other way.
              const dirFar = l.entersAt === 'from' ? 1 : -1;
              const sFar = l.entersAt === 'from' ? 0 : far.length;
              const lanesFar = road.lanesAt(l.edge, sFar);
              const oncoming = lanesFar.filter((x) => x.kind === 'drive' && x.direction === -dirFar);
              // How deep the landing reaches into each oncoming lane.
              const depth = (x: LaneInfo) =>
                Math.min(dHi, x.dCenterM + x.widthM / 2) - Math.max(dLo, x.dCenterM - x.widthM / 2);
              const deepest = Math.max(0, ...oncoming.map(depth));
              const hits = oncoming.filter((x) => depth(x) > ONCOMING_SLACK_M);
              const ours = travelLanes(lanesFar, dirFar);
              const mid = (dLo + dHi) / 2;
              const inOurs = ours.some((x) => Math.abs(mid - x.dCenterM) <= x.widthM / 2);
              const line = `${r.id}: ${key} lands d ${dLo.toFixed(2)}..${dHi.toFixed(2)}${
                deepest > 0 ? `, ${deepest.toFixed(2)} m into the oncoming lane` : ''
              }${hits.length > 0 ? ` (TOO DEEP: ${hits.map((x) => x.id).join('+')})` : ''}${
                inOurs ? '' : ' (middle outside the travel lanes)'
              }`;
              lines.push(line);
              if (hits.length > 0 || !inOurs) faults.push(line);
            }
          }
        }
      }
    }
    console.log(`[examined] ${routes} routes, ${rejoins} branch rejoins\n  ${lines.join('\n  ')}`);
    expect(faults).toEqual([]);
    // The hand-made tracks' rejoins (the Keys' boat ramp, sandbar and boardwalk, the PNW spur, SF's
    // stair alley and park cut) and the map-data networks' real junctions.
    expect(rejoins).toBeGreaterThanOrEqual(10);
  });
});
