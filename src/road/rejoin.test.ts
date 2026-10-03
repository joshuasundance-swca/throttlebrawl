import { describe, expect, it } from 'vitest';
import { compileTrack } from './compile';
import { fixtureBranchTrack } from './fixture';

// Run W-U's live check, mustFix 1: the Keys' Mangrove Boardwalk rejoined its road in the oncoming
// lane (join lane L1, d -3), so riders came off it head-on into traffic. The compiler now refuses a
// branch whose rejoin does not land in a lane running the route's way.
describe('the road compiler: a branch rejoins in a travel lane', () => {
  const withJoin = (join: { road: string; offsetM: number; lane: string }) => {
    const base = fixtureBranchTrack();
    const br = base.branches?.[0];
    if (!br) throw new Error('the fixture has a branch');
    return { ...base, branches: [{ ...br, join }] };
  };

  it('compiles the fixture, which rejoins in its travel lane (R1, d 2.4)', () => {
    expect(() => compileTrack(fixtureBranchTrack())).not.toThrow();
  });

  it('refuses a rejoin in the oncoming lane (the boardwalk shape: L1, left of the centre line)', () => {
    expect(() => compileTrack(withJoin({ road: 'd', offsetM: -2.4, lane: 'L1' }))).toThrow(
      /rejoins .* oncoming/,
    );
  });

  it('refuses a rejoin that names the travel lane but lands across the centre line', () => {
    expect(() => compileTrack(withJoin({ road: 'd', offsetM: -1, lane: 'R1' }))).toThrow(/rejoins/);
  });

  it('refuses a rejoin lane the road does not have', () => {
    expect(() => compileTrack(withJoin({ road: 'd', offsetM: 2.4, lane: 'R9' }))).toThrow(/rejoins/);
  });
});
