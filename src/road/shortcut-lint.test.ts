// The shortcut lint (playtest 4, P4-4 and P4-8; the riding audit's F8b): "shortcut and junction
// entries and exits are rough", and "it does make it hard to take certain shortcuts". A steering
// bike holds a bend only up to a speed that falls with its radius, and a split zone only the edge
// of the road reaches is a turn-off a rider has to be pressed against the rail to take. The rules
// the lint protects: a shortcut's connector, with the 80 m of road on its shortcut side, holds at
// 30 m/s for the starter bike, and the zone that picks it starts well inside a rider's reach.
import { describe, expect, it } from 'vitest';
import { compileTrack } from './compile';
import { fixtureBranchTrack } from './fixture';
import {
  lintRoadNetwork,
  ROAD_LINT,
  type BakedNetwork,
  type BakedNetworkBundle,
  type BakedRoad,
  type BakedRoute,
} from './index';
import type { TrackSource } from './compile';

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends object ? Mutable<T[K]> : T[K] };

function bake(edit?: (t: TrackSource) => void): BakedNetworkBundle & { route: BakedRoute } {
  const track = fixtureBranchTrack();
  edit?.(track);
  const out = compileTrack(track);
  return {
    network: out.network as unknown as BakedNetwork,
    roads: out.roads as unknown as BakedRoad[],
    route: out.routes[0] as unknown as BakedRoute,
  };
}

const shortcutIssues = (b: ReturnType<typeof bake>) =>
  lintRoadNetwork({ network: b.network, roads: b.roads, routes: [b.route] }).filter(
    (i) => i.rule === 'shortcut',
  );

describe('the shortcut lint: the bend a rider has to hold', () => {
  it('holds only up to the speed the steering can follow: 30 m/s needs a radius of about 41 m', () => {
    // v² = yawResponse · steerRate · R, the riders' heading model at full lock.
    const r =
      (ROAD_LINT.shortcutArrivalMps * ROAD_LINT.shortcutArrivalMps) /
      (ROAD_LINT.shortcutYawResponse * ROAD_LINT.shortcutSteerRateMps);
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(42);
  });

  it('passes a shortcut whose connectors are gentle', () => {
    expect(shortcutIssues(bake())).toEqual([]);
  });

  it('fails a shortcut whose turn-off bends tighter than the bike holds at 30 m/s, naming the connector', () => {
    const tight = bake((t) => {
      const br = t.branches?.[0];
      if (!br) throw new Error('no branch');
      (br as Mutable<typeof br>).turnsM = [8, 40];
    });
    const issues = shortcutIssues(tight);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.message.includes('c-in') && /radius/.test(i.message))).toBe(true);
    // The rejoin is the other end of the same rule.
    const tightOut = bake((t) => {
      const br = t.branches?.[0];
      if (!br) throw new Error('no branch');
      (br as Mutable<typeof br>).turnsM = [40, 8];
    });
    expect(shortcutIssues(tightOut).some((i) => i.message.includes('c-out'))).toBe(true);
  });

  it('counts the 80 m of road after a turn-off’s connector too, not only the connector', () => {
    const b = bake() as Mutable<ReturnType<typeof bake>>;
    const cut = b.roads.find((r) => r.id === 'cut');
    if (!cut) throw new Error('no cut road');
    // A sharp stored curvature 50 m into the shortcut road, inside the first 80 m.
    const k = cut.samples.data['kappa'] as number[];
    const i = Math.round(50 / cut.sampleSpacingM);
    k[i] = 1 / 20;
    expect(shortcutIssues(b).some((x) => x.message.includes('cut'))).toBe(true);
    // The road before a rejoin is the shortcut's own (a real street's corner), not the connector's.
    const exit = bake() as Mutable<ReturnType<typeof bake>>;
    const cut3 = exit.roads.find((r) => r.id === 'cut');
    if (!cut3) throw new Error('no cut road');
    (cut3.samples.data['kappa'] as number[])[Math.round((cut3.lengthM - 30) / cut3.sampleSpacingM)] = 1 / 20;
    expect(shortcutIssues(exit)).toEqual([]);
    // And past the 80 m it is the road's own business, not the junction's.
    const far = bake() as Mutable<ReturnType<typeof bake>>;
    const cut2 = far.roads.find((r) => r.id === 'cut');
    if (!cut2) throw new Error('no cut road');
    (cut2.samples.data['kappa'] as number[])[Math.round(120 / cut2.sampleSpacingM)] = 1 / 20;
    expect(shortcutIssues(far)).toEqual([]);
  });
});

describe('the shortcut lint: where the zone starts', () => {
  const zoneOf = (b: ReturnType<typeof bake>) => {
    for (const j of b.network.junctions)
      for (const raw of j.connectors) {
        const c = raw as { splitZone?: { s0: number; s1: number; d0: number; d1: number } };
        if (c.splitZone) return c.splitZone;
      }
    throw new Error('no split zone');
  };

  it('fails a zone that starts less than 1.5 m inside the rider’s reach, passes one that starts well inside', () => {
    const b = bake() as Mutable<ReturnType<typeof bake>>;
    const z = zoneOf(b) as { d0: number; d1: number };
    // The fixture's lanes end at d 4.9 on the right; a rider's centre reaches 4.4.
    expect(shortcutIssues(b)).toEqual([]);
    z.d0 = 4.4;
    z.d1 = 6.5;
    const issues = shortcutIssues(b);
    expect(issues.some((i) => i.pointer.endsWith('/splitZone') && /reach/.test(i.message))).toBe(true);
  });

  it('leaves a zone that stands wholly past the edge alone (a cut over a wall is reached by a truck)', () => {
    const b = bake() as Mutable<ReturnType<typeof bake>>;
    const z = zoneOf(b) as { d0: number; d1: number };
    z.d0 = 5.5;
    z.d1 = 9;
    expect(shortcutIssues(b).filter((i) => i.pointer.endsWith('/splitZone'))).toEqual([]);
  });

  it('leaves the zone of a secret fork alone (it is found on the beach, not painted)', () => {
    const b = bake() as Mutable<ReturnType<typeof bake>>;
    const z = zoneOf(b) as { d0: number; d1: number };
    z.d0 = 4.4;
    z.d1 = 6.5;
    const connector = b.roads.find((r) => r.id === 'c-in') as Mutable<BakedRoad>;
    connector.tags = [
      ...(connector.tags ?? []),
      { s0: 0, s1: connector.lengthM, side: 'both', tag: 'secret' },
    ];
    expect(shortcutIssues(b).filter((i) => i.pointer.endsWith('/splitZone'))).toEqual([]);
  });
});
