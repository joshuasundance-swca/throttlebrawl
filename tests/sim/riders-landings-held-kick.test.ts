// Forgiving landings with the kick held 0.35 s in the air, on every region's routes: the same
// check as the brake's in tests/sim/riders-landings-held.test.ts (which says what it holds and why),
// in a file of its own so CI can run the two on different runners (tests/sim/landings-held.ts).
import { describe, it } from 'vitest';
import { checkHeld, HELD_TIMEOUT_MS } from './landings-held';

describe('forgiving landings: the brake or the kick held in the air on every route (W-Q0 verifier)', () => {
  it('kick held 0.35 s: 0 jumps down', () => checkHeld('kick held 0.35 s'), HELD_TIMEOUT_MS);
});
