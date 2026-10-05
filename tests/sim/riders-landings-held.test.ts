// Forgiving landings, with the brake or the kick held in the air (playtest 2, 2026-10-02: "It's too
// easy to crash after a jump"; interview, 2026-10-02: "forgiving landings; flips and tricks").
// The W-Q0 verifier's repro, on the real roads: San Francisco, seed 1, the bot rides, and at a
// take-off the player takes over and holds S (the brake) to the touch-down. With air control on
// that put 23 of 34 jumps down (0 of 34 with it off), and a kick held 0.35 s put 9 of 34 down.
// Braking or attacking in the air must never wreck a landing: only a deliberate, badly
// over-rotated flip wipes out. src/sim/riders/air-safety.test.ts holds the same bar on the riders
// lane's fixture ramp and crest; this file holds it on every region's routes, where the ground
// under a landing is a real road's crest and bend, not a fixture's.
//
// Each race: the bot rides; 0.1 s after each of the player's take-offs (the browser repro's timing)
// the player takes over with the bars straight and gives the air command, and the bot rides on after
// the touch-down. Road events stay on, as the game races.
//
// This file runs the brake; tests/sim/riders-landings-held-kick.test.ts runs the kick, with the same
// check (tests/sim/landings-held.ts), so CI can run the two on different runners.
import { describe, it } from 'vitest';
import { checkHeld, HELD_TIMEOUT_MS } from './landings-held';

describe('forgiving landings: the brake or the kick held in the air on every route (W-Q0 verifier)', () => {
  it('brake held to the ground: 0 jumps down', () => checkHeld('brake held to the ground'), HELD_TIMEOUT_MS);
});
