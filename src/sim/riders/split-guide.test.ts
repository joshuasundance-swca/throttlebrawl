import { describe, expect, it } from 'vitest';
import { createRoadNetwork, createRouteProgress, fixtureBranchNetwork } from '../../road';
import { SPLIT_GUIDE_LEAD_M } from './index';
import { input, riderHarness, testConfig } from './testing';

// Playtest 1c (the skeptic's mustFix from playtest 1b): a split zone's outer edge, where it is also
// the road's edge, guides a rider along it to the split instead of walling it. The fixture's split
// zone is the last 40 m of road `a` (s 160 to 200, d 2.4 to 4.9); the bike's centre meets the
// road's edge at d 4.4.

function harness(allowCut: boolean, s: number) {
  const f = fixtureBranchNetwork();
  const road = createRoadNetwork(f);
  const cutRoads = new Set(['c-in', 'cut', 'c-out']);
  const route = createRouteProgress(road, {
    ...f.route,
    allowedRoads: allowCut ? f.route.allowedRoads : f.route.allowedRoads.filter((id) => !cutRoads.has(id)),
  });
  const config = { ...testConfig(), road, route };
  const h = riderHarness(config, { edge: road.edgeIndex('a'), s, d: 3.6, speed: 30, yaw: 0.2 });
  return { h, road };
}

/** Full throttle and full right lock until the rider leaves road `a`; the barrier events on `a`. */
function holdRight(allowCut: boolean, s: number) {
  const { h, road } = harness(allowCut, s);
  const a = road.edgeIndex('a');
  const walls: string[] = [];
  let minSpeed = Infinity;
  for (let t = 0; t < 600 && h.rider.pos.edge === a; t++) {
    const pos = { ...h.rider.pos };
    for (const ev of h.step(input(1, 0, 1))) {
      if (ev.type === 'wobble' || ev.type === 'crash') walls.push(`${ev.type}@s ${pos.s.toFixed(1)}`);
    }
    if (h.rider.pos.edge === a) minSpeed = Math.min(minSpeed, h.rider.speed);
  }
  return { walls, minSpeed, edge: road.edges[h.rider.pos.edge]?.id };
}

describe('a split zone guides a rider along its outer edge to the split', () => {
  it('inside the zone, holding right into the edge: no barrier event, no speed lost, onto the branch', () => {
    const r = holdRight(true, 165);
    expect(r.walls).toEqual([]);
    expect(r.minSpeed).toBeGreaterThanOrEqual(30 - 0.5);
    expect(r.edge).toBe('c-in');
  });

  it(`the guide starts ${SPLIT_GUIDE_LEAD_M} m before the zone (the lead-in)`, () => {
    const r = holdRight(true, 160 - SPLIT_GUIDE_LEAD_M + 1);
    expect(r.walls).toEqual([]);
    expect(r.edge).toBe('c-in');
  });

  it('well before the zone the edge is still a barrier: a wobble', () => {
    const r = holdRight(true, 160 - SPLIT_GUIDE_LEAD_M - 40);
    expect(r.walls.length).toBeGreaterThan(0);
    expect(r.walls[0]).toMatch(/^wobble/);
  });

  it('when the race does not allow the branch, the zone edge stays a barrier', () => {
    const r = holdRight(false, 165);
    expect(r.walls.length).toBeGreaterThan(0);
  });
});
