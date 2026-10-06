// The road lint's playtest 3 rules (T3.1): jumpable walls, gap params, gaps off the main path, and
// landmarks clear of the road unless they span it (`overRoad`). Each rule is shown catching a bad
// file and passing the good one, so a pass means something.
import { describe, expect, it } from 'vitest';
import {
  fixtureBranchNetwork,
  fixtureNetwork,
  lintRoad,
  lintRoadNetwork,
  type BakedBarrier,
  type BakedFeature,
  type BakedRoad,
  type RoadLintIssue,
} from './index';

const base = (): BakedRoad =>
  JSON.parse(JSON.stringify(fixtureNetwork([{ id: 'a', lengthM: 400, kappa: 0 }]).roads[0])) as BakedRoad;

const withFeature = (f: BakedFeature): BakedRoad => ({ ...base(), features: [f] });
const withBarrier = (b: BakedBarrier): BakedRoad => ({ ...base(), barriers: [b] });

const messages = (issues: readonly RoadLintIssue[]) =>
  issues.map((i) => `${i.rule} ${i.pointer}: ${i.message}`);

describe('jumpable walls', () => {
  it('a jumpable rail is an error; a jumpable wall is fine', () => {
    const rail = lintRoad(
      withBarrier({ s0: 0, s1: 100, side: 'right', kind: 'rail', heightM: 1, jumpable: true }),
    );
    expect(messages(rail)).toEqual([
      expect.stringMatching(/^features \/barriers\/0\/jumpable: .*only a wall/),
    ]);
    expect(
      lintRoad(withBarrier({ s0: 0, s1: 100, side: 'right', kind: 'wall', heightM: 1.2, jumpable: true })),
    ).toEqual([]);
  });
});

describe('every barrier has its height (over the barrier, 2026-10-06)', () => {
  it('refuses a barrier with no height, or one that is not a height; passes one with its height', () => {
    const noHeight = { s0: 0, s1: 100, side: 'left', kind: 'rail' } as unknown as BakedBarrier;
    const bad = [noHeight, { ...noHeight, heightM: 0 }, { ...noHeight, kind: 'wall', heightM: Infinity }];
    for (const b of bad) {
      const issues = messages(lintRoad(withBarrier(b)));
      console.log(`[examined] ${JSON.stringify(b)}: ${issues.join(' | ')}`);
      expect(issues).toEqual([expect.stringMatching(/^features \/barriers\/0\/heightM: .*needs its height/)]);
    }
    // The control: the same barrier with a real height passes, so the refusal is the height's.
    expect(lintRoad(withBarrier({ ...noHeight, heightM: 1 }))).toEqual([]);
  });
});

describe('gap params', () => {
  const gap = (params?: Record<string, unknown>): BakedFeature => ({
    kind: 'gap',
    id: 'hole',
    s0: 100,
    s1: 130,
    d0: -8,
    d1: 8,
    ...(params ? { params } : {}),
  });

  it('flags a value the reader would replace with its default, so a typo never passes silently', () => {
    const issues = lintRoad(withFeature(gap({ killDepthM: -1, respawn: 'highway', respawnPastM: 'far' })));
    expect(messages(issues)).toEqual([
      expect.stringMatching(/^features \/features\/0\/params\/killDepthM: /),
      expect.stringMatching(/^features \/features\/0\/params\/respawn: .*far.*main/),
      expect.stringMatching(/^features \/features\/0\/params\/respawnPastM: /),
    ]);
  });

  it('a gap with no params, or good ones, passes', () => {
    expect(lintRoad(withFeature(gap()))).toEqual([]);
    expect(lintRoad(withFeature(gap({ killDepthM: 3, respawn: 'main', respawnPastM: 20 })))).toEqual([]);
  });
});

describe('a gap on the main path', () => {
  it('is a route error (traffic runs the main path and would drive into it); on a branch it is fine', () => {
    const f = fixtureBranchNetwork();
    const hole: BakedFeature = { kind: 'gap', id: 'hole', s0: 40, s1: 60, d0: -8, d1: 8 };
    const put = (roadId: string) =>
      f.roads.map((r) => (r.id === roadId ? { ...r, features: [...(r.features ?? []), hole] } : r));
    const onMain = lintRoadNetwork({ network: f.network, roads: put('a'), routes: [f.route] }).filter(
      (i) => i.rule === 'route',
    );
    expect(messages(onMain)).toEqual([expect.stringMatching(/^route \/mainPath\/0: .*a holds gap hole/)]);
    const onBranch = lintRoadNetwork({ network: f.network, roads: put('cut'), routes: [f.route] }).filter(
      (i) => i.rule === 'route',
    );
    expect(onBranch).toEqual([]);
  });
});

describe('landmarks', () => {
  // The fixture's lanes reach d ±4.9; with no tags the derived verge is palm land a few metres wide.
  const landmark = (
    d0: number,
    d1: number,
    params: Record<string, unknown> = { model: 'kit#tower' },
  ): BakedFeature => ({
    kind: 'landmark',
    id: 'lm',
    s0: 100,
    s1: 130,
    d0,
    d1,
    params,
  });

  it('a footprint on the road or its verge is an error, unless the structure spans the road', () => {
    const onRoad = lintRoad(withFeature(landmark(3, 20)));
    expect(messages(onRoad)).toEqual([expect.stringMatching(/^landmark-clear \/features\/0: /)]);
    const left = lintRoad(withFeature(landmark(-20, -4)));
    expect(messages(left)).toEqual([expect.stringMatching(/^landmark-clear \/features\/0: /)]);
    expect(lintRoad(withFeature(landmark(-14, 14, { model: 'kit#tower', overRoad: true })))).toEqual([]);
  });

  it('a footprint wholly past the verge passes', () => {
    expect(lintRoad(withFeature(landmark(40, 70)))).toEqual([]);
    expect(lintRoad(withFeature(landmark(-70, -40)))).toEqual([]);
  });

  it('flags a missing model and out-of-range placement values', () => {
    const issues = lintRoad(withFeature(landmark(40, 70, { yawDeg: 270, scale: 9, farM: 0 })));
    expect(messages(issues)).toEqual([
      expect.stringMatching(/^features \/features\/0\/params\/model: /),
      expect.stringMatching(/^features \/features\/0\/params\/yawDeg: /),
      expect.stringMatching(/^features \/features\/0\/params\/scale: /),
      expect.stringMatching(/^features \/features\/0\/params\/farM: /),
    ]);
  });

  it('takes an island flag and a whole-number number, and flags a typo in either', () => {
    expect(
      lintRoad(withFeature(landmark(40, 70, { model: 'kit#island', island: true, number: 46 }))),
    ).toEqual([]);
    const issues = lintRoad(withFeature(landmark(40, 70, { model: 'kit#post', island: 'yes', number: 4.5 })));
    expect(messages(issues)).toEqual([
      expect.stringMatching(/^features \/features\/0\/params\/island: /),
      expect.stringMatching(/^features \/features\/0\/params\/number: /),
    ]);
    const negative = lintRoad(withFeature(landmark(40, 70, { model: 'kit#post', number: -1 })));
    expect(messages(negative)).toEqual([expect.stringMatching(/^features \/features\/0\/params\/number: /)]);
  });
});
