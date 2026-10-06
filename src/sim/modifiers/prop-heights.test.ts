// A set-piece prop is met below its drawn height (the hitbox audit's contract, core
// SET_PIECE_PROP_HEIGHT_M; docs/content-packs.md, "Heights and hitboxes"): a rider on the road or in
// the air below a cone's 1.35 m knocks it, one above clears it. It was a flat 0.8 m, and only for a
// rider on the road: a jump through a cone at 0.5 m passed through it.
import { describe, expect, it } from 'vitest';
import { SET_PIECE_PROP_HEIGHT_M } from '../../core';
import { riderMeetsProp } from './setpieces';

describe('which riders meet a set-piece prop', () => {
  it('on the road or in the air below its top meets it; above its top, or down, does not', () => {
    for (const kind of ['cone', 'flare', 'barricade', 'hayBale'] as const) {
      const top = SET_PIECE_PROP_HEIGHT_M[kind];
      expect(riderMeetsProp(kind, 'Road', 0), kind).toBe(true);
      expect(riderMeetsProp(kind, 'Airborne', top - 0.05), kind).toBe(true);
      expect(riderMeetsProp(kind, 'Airborne', top + 0.05), kind).toBe(false);
      expect(riderMeetsProp(kind, 'Tumble', 0), kind).toBe(false);
      expect(riderMeetsProp(kind, 'OnFoot', 0), kind).toBe(false);
    }
  });

  it('a jump at 1.0 m knocks a cone (1.35 m) and a barricade (1.3 m) but clears a hay bale (0.7 m)', () => {
    expect(riderMeetsProp('cone', 'Airborne', 1.0)).toBe(true);
    expect(riderMeetsProp('barricade', 'Airborne', 1.0)).toBe(true);
    expect(riderMeetsProp('hayBale', 'Airborne', 1.0)).toBe(false);
  });
});
