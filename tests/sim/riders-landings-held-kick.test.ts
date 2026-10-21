// Forgiving landings with the kick held 0.35 s in the air, on every region's routes: the same
// check as the brake's in tests/sim/riders-landings-held.test.ts (which says what it holds and why),
// in a file of its own so CI can run the two on different runners (tests/sim/landings-held.ts).
import { describe, expect, it } from 'vitest';
import { checkHeld, heldCheck, HELD_AGGREGATE_TIMEOUT_MS, HELD_TIMEOUT_MS } from './landings-held';

describe('forgiving landings: the brake or the kick held in the air on every route (W-Q0 verifier)', () => {
  const check = heldCheck('kick held 0.35 s');
  for (const c of check.cases) {
    it(
      `kick held 0.35 s: ${c.event} ${c.route ?? ''}`,
      () => {
        expect(check.run(c).down).toEqual([]);
      },
      HELD_TIMEOUT_MS,
    );
  }
  it('kick held 0.35 s: 0 jumps down', () => checkHeld('kick held 0.35 s', check), HELD_AGGREGATE_TIMEOUT_MS);
});
