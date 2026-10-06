/// <reference types="vite/client" />
// The bridge-end sweep (playtest 4, the maintainer on the Historic Columbia River Highway: "when it
// goes from grass to bridge or whatever the rider clips from open air onto the bridge. You can see
// it happen if you stay to the far right"). Every bridge end on every network a route races on, a
// rider at the far right and at the far left of where it may ride (off-road on, the live default),
// riding onto the bridge from off it, across a road's end included. The rule:
// - the edge of where it may ride never narrows faster than BRIDGE_TAPER_SLOPE (1 in 10) as it
//   comes to the bridge: no sideways jump onto the deck;
// - the ground under its centre at that edge is always road, verge or deck;
// - within LAND_STOP_M of the bridge's end, where render's land plate has stopped (road-mesh.ts: no
//   land within 5 m of a rail), its centre is on the road's own lanes, so it is never out over air.
// The edge is the one the riding model holds a rider in (sim/ground's `rideLimits`, with the
// lane-drop funnel where the lanes narrow too: sim/riders/funnel.ts).
import { describe, expect, it } from 'vitest';
import { BRIDGE_TAPER_SLOPE, bridgedAt, type RoadNetwork, type RoadPos } from '../../src/road';
import { rideLimits } from '../../src/sim/ground';
import { print, routeFileCount, routeNetworks, track } from './geometry-routes';

/** The live default: riders may ride the verge (sim/ground.ts, `ground.offRoad`). */
const PARAMS = { 'ground.offRoad': 1 };
/** Half a bike (sim/riders' BIKE_HALF_WIDTH_M). */
const HALF_M = 0.5;
/** Samples along the approach, m. */
const STEP_M = 0.5;
/** Past the band's whole taper (its width off the bridge over the slope), the approach walks this much more, m. */
const WALK_MARGIN_M = 10;
/** Render's land plate stops this far short of a rail (road-mesh.ts, the tagged land's rail rule). */
const LAND_STOP_M = 5;
/** Rounding room on a step, m. */
const TOL_M = 0.02;

interface Sample {
  pos: RoadPos;
  /** The far right and far left of the rider's centre, in the approaching rider's own frame. */
  right: number;
  left: number;
  /** The lanes' outer edges in the same frame (where they change, the lane-drop funnel's ground). */
  laneRight: number;
  laneLeft: number;
  /** The same edges in the road frame, for the ground queries. */
  hiD: number;
  loD: number;
  /** Distance from the bridge's end, m. */
  outM: number;
}

/** The lanes' outer edges at (edge, s). */
function laneEdges(road: RoadNetwork, edge: number, s: number): { lo: number; hi: number } {
  let lo = 0;
  let hi = 0;
  for (const l of road.lanesAt(edge, s)) {
    lo = Math.min(lo, l.dCenterM - l.widthM / 2);
    hi = Math.max(hi, l.dCenterM + l.widthM / 2);
  }
  return { lo, hi };
}

/** Whether a join between two edges is a split's or a merge's (the split guide's ground, not this). */
function branchJoin(road: RoadNetwork, a: number, b: number): boolean {
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const end of ['from', 'to'] as const) {
      for (const l of road.nextEdges(x, end)) {
        if (l.edge === y && (l.splitZone || (l.dShift ?? 0) !== 0)) return true;
      }
    }
  }
  return false;
}

/**
 * The approach to one bridge end: walked out from just inside the bridge for `walkM`, then listed
 * from far out to the bridge, each sample in the frame of a rider riding toward the bridge. The walk
 * stops at a split's or a merge's join, where the rider's place across the road picks the way.
 */
function approach(road: RoadNetwork, edge: number, sEnd: number, outward: 1 | -1, walkM: number): Sample[] {
  const walker: RoadPos = { edge, s: sEnd - outward * 1, d: 0, dir: outward };
  const out: Sample[] = [];
  for (let a = -1; a <= walkM; a += STEP_M) {
    if (a > -1) {
      const was = walker.edge;
      walker.s += walker.dir * STEP_M;
      if (road.advance(walker) === 'deadEnd' || (walker.edge !== was && branchJoin(road, was, walker.edge)))
        break;
    }
    // The rider rides the other way; its frame's centreline is the walker's (walker.d is its image).
    const rider: RoadPos = { edge: walker.edge, s: walker.s, d: walker.d, dir: walker.dir === 1 ? -1 : 1 };
    const lim = rideLimits(road, PARAMS, rider.edge, rider.s, HALF_M);
    const lanes = laneEdges(road, rider.edge, rider.s);
    const inFrame = (lo: number, hi: number) =>
      rider.dir === 1
        ? { right: hi - walker.d, left: lo - walker.d }
        : { right: -(lo - walker.d), left: -(hi - walker.d) };
    const { right, left } = inFrame(lim.lo, lim.hi);
    const l = inFrame(lanes.lo, lanes.hi);
    out.push({
      pos: rider,
      right,
      left,
      laneRight: l.right,
      laneLeft: l.left,
      hiD: lim.hi,
      loD: lim.lo,
      outM: a,
    });
  }
  return out.reverse();
}

describe('bridge ends: the verge narrows into every bridge (playtest 4)', () => {
  it('a rider at the far right or far left never jumps sideways onto a deck, nor rides over air', () => {
    const nets = routeNetworks();
    let ends = 0;
    let samples = 0;
    let worst = { rate: 0, where: '' };
    const failures: string[] = [];
    for (const net of nets) {
      const road = track(net).road;
      for (const e of road.edges) {
        for (const t of e.tags) {
          if (t.tag !== 'bridge') continue;
          for (const [sEnd, outward] of [
            [t.s0, -1],
            [t.s1, 1],
          ] as const) {
            // An end that another bridge stretch carries on past is no end.
            const sides = t.side === 'both' ? (['left', 'right'] as const) : ([t.side] as const);
            const probe = sEnd + outward * 0.05;
            if (probe >= 0 && probe <= e.length && sides.every((sd) => bridgedAt(e.tags, sd, probe)))
              continue;
            // The walk covers the widest band beside this end's approach on its whole taper.
            const probeList = approach(road, e.index, sEnd, outward, 200);
            let band = 0;
            for (const p of probeList) band = Math.max(band, p.right - p.laneRight, p.laneLeft - p.left);
            const list = approach(
              road,
              e.index,
              sEnd,
              outward,
              (band + HALF_M) / BRIDGE_TAPER_SLOPE + WALK_MARGIN_M,
            );
            if (list.length < 2) continue;
            ends++;
            const label = `${net.id} ${e.id} bridge ${outward < 0 ? 'start' : 'end'} s ${sEnd.toFixed(1)}`;
            for (let i = 1; i < list.length; i++) {
              const a = list[i - 1]!;
              const b = list[i]!;
              samples++;
              // Narrowing toward the bridge: the right edge coming in, the left edge coming in. Where
              // the lanes themselves narrow, the lane-drop funnel eases the rider in (its own tests).
              for (const [name, inward, lanesMoved] of [
                ['right', a.right - b.right, Math.abs(a.laneRight - b.laneRight) > TOL_M],
                ['left', b.left - a.left, Math.abs(a.laneLeft - b.laneLeft) > TOL_M],
              ] as const) {
                if (lanesMoved) continue;
                const rate = inward / STEP_M;
                if (rate > worst.rate)
                  worst = { rate, where: `${label}, ${name}, ${b.outM.toFixed(1)} m out` };
                if (inward > BRIDGE_TAPER_SLOPE * STEP_M + TOL_M)
                  failures.push(
                    `${label}: the ${name} edge jumps ${inward.toFixed(2)} m at ${b.outM.toFixed(1)} m out`,
                  );
              }
              // The ground under the rider's centre at each edge.
              for (const d of [b.hiD, b.loD]) {
                if (road.groundAt(b.pos.edge, b.pos.s, d) === null)
                  failures.push(
                    `${label}: no ground under the edge at ${b.outM.toFixed(1)} m out (d ${d.toFixed(2)})`,
                  );
              }
              // Where render's land has stopped, the rider at either edge is on the road's lanes.
              if (b.outM <= LAND_STOP_M) {
                const lanes = laneEdges(road, b.pos.edge, b.pos.s);
                if (b.hiD > lanes.hi + TOL_M || b.loD < lanes.lo - TOL_M)
                  failures.push(`${label}: out on the verge ${b.outM.toFixed(1)} m from the deck`);
              }
            }
          }
        }
      }
    }
    print(
      `[examined] ${ends} bridge ends on ${nets.length} networks (${routeFileCount()} route files), ` +
        `${samples} half-metre steps of a rider riding onto the deck at the far right and far left; ` +
        `steepest narrowing ${worst.rate.toFixed(3)} m per m (${worst.where}); limit ${BRIDGE_TAPER_SLOPE}`,
    );
    // The sweep is shown able to see a bridge: the real routes have dozens of bridge ends.
    expect(ends).toBeGreaterThan(30);
    expect(failures.slice(0, 20)).toEqual([]);
  });
});
