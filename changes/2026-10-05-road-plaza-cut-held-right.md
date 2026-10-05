---
kind: fixed
audience: player
---
On San Francisco's Downtown route, holding the stick right through the whole jump off the parked car carrier no longer crashes the bike. The Plaza Cut's far side was a hard edge, and a bike held right crossed the whole cut in the air and hit it, three times out of three in the live check. Now that side is a soft strip of paving: the bike is stopped at the cut's side without a crash, comes down on the cut and rides it out. Letting go of the stick, holding it left or holding nothing already stayed on Campus Way, and still does.

For devs: the Plaza Cut's own roads are tagged `plaza-cut` on the right only (`tools/road/tracks/sf-downtown.ts`, with the three pack road files re-baked), and `src/road/cross-section.ts` derives 2 m of soft kerb for that tag. A rider's flight was ending on the cut's hard edge (`crash`, cause `barrier`, side 1, on `c-dt-plaza-in`); the Mill Yard Cut already had a soft edge from its sawmill tag, so it needed no change. No sim code changed. Render's verge strip is unchanged (it never read the tag).

Checks: `tools/road/truck-shortcuts.test.ts` now flies a held right, a held left and no steering from the lip, 36 flights per cut (six lip speeds from 24 to 48 m/s, two start positions), and asserts no crash, a landing, only the route's own roads and the route's last piece reached. Before the fix the Plaza Cut's held-right flights crashed (the first, 24 m/s, fails the test); the Mill Yard Cut passed both before and after. A second test asserts the right edge of each cut road is soft. Sim ticks only, no browser; not phone-verified.
