import { describe, expect, it } from 'vitest';
import { fixtureNetwork, lintRoad } from './index';
import {
  GAP_DEFAULTS,
  gapParams,
  LANDMARK_DEFAULTS,
  landmarkParams,
  type BakedFeature,
  type BakedRoad,
} from './types';

// Playtest 3's road contract (K0b; the maintainer, 2026-10-03: "the 7 mile bridge has an old road
// parallel to it. Jumps could let you get from one to the other"; round 3: "the real 80 m missing
// span is the big jump (a miss = splash, respawn on the highway)"; round 1: "real landmarks").
// The readers here are what the sim, render and the lints read the free-form params through, so a
// missing or bad value always means the same default.

const gap = (params?: Record<string, unknown>): BakedFeature => ({
  kind: 'gap',
  id: 'moser',
  s0: 100,
  s1: 164,
  d0: -4,
  d1: 4,
  ...(params ? { params } : {}),
});

describe('gap params', () => {
  it('defaults: crash 1.5 m below the deck, wake on the far side 10 m past the gap', () => {
    expect(gapParams(gap())).toEqual({
      killDepthM: GAP_DEFAULTS.killDepthM,
      respawn: 'far',
      respawnPastM: GAP_DEFAULTS.respawnPastM,
    });
    expect(GAP_DEFAULTS).toEqual({ killDepthM: 1.5, respawnPastM: 10 });
  });

  it("takes a gap's own values, and `respawn: 'main'` wakes the rider on the route's main road", () => {
    expect(gapParams(gap({ killDepthM: 3, respawn: 'main', respawnPastM: 25 }))).toEqual({
      killDepthM: 3,
      respawn: 'main',
      respawnPastM: 25,
    });
  });

  it('a bad value means the default, never a throw', () => {
    expect(gapParams(gap({ killDepthM: -1, respawn: 'moon', respawnPastM: 'far' }))).toEqual(
      gapParams(gap()),
    );
  });
});

describe('landmark params', () => {
  const landmark = (params: Record<string, unknown>): BakedFeature => ({
    kind: 'landmark',
    id: 'gg-south-tower',
    s0: 200,
    s1: 230,
    d0: -14,
    d1: 14,
    params,
  });

  it('reads the model and its placement, with the defaults', () => {
    expect(landmarkParams(landmark({ model: 'models/landmarks/golden-gate#tower' }))).toEqual({
      model: 'models/landmarks/golden-gate#tower',
      yawDeg: 0,
      scale: 1,
      farM: LANDMARK_DEFAULTS.farM,
      overRoad: false,
    });
    expect(LANDMARK_DEFAULTS.farM).toBe(400);
  });

  it('a structure that spans the road says overRoad (the lint keeps every other footprint off it)', () => {
    const p = landmarkParams(
      landmark({
        model: 'models/landmarks/golden-gate#tower',
        yawDeg: -90,
        scale: 1.5,
        farM: 900,
        overRoad: true,
      }),
    );
    expect(p).toMatchObject({ yawDeg: -90, scale: 1.5, farM: 900, overRoad: true });
  });

  it('no model means null, so render skips it; out-of-range numbers take the defaults', () => {
    expect(landmarkParams(landmark({ yawDeg: 270, scale: 9, farM: 0 }))).toEqual({
      model: null,
      yawDeg: 0,
      scale: 1,
      farM: 400,
      overRoad: false,
    });
  });
});

describe('the road lint knows the new kind', () => {
  it('a landmark feature is no unknown kind', () => {
    const road = fixtureNetwork([{ id: 'straight', lengthM: 200, kappa: 0 }]).roads[0] as BakedRoad;
    const withLandmark: BakedRoad = {
      ...road,
      features: [
        ...(road.features ?? []),
        { kind: 'landmark', id: 'lm', s0: 0, s1: 10, d0: 30, d1: 40, params: { model: 'x#y' } },
      ],
    };
    const kinds = lintRoad(withLandmark).filter((i) => i.message.startsWith('unknown feature kind'));
    expect(kinds).toEqual([]);
    const typo = lintRoad({
      ...withLandmark,
      features: [{ ...withLandmark.features![0]!, kind: 'landmarks' }],
    });
    expect(typo.filter((i) => i.message.startsWith('unknown feature kind'))).toHaveLength(1);
  });
});
