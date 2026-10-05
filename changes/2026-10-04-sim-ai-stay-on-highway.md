---
kind: fixed
audience: player
---
On the Seven Mile Bridge, rivals and cops now stay on the highway even when you shove them at the turn-off (playtest 3, round 3: "rivals and cops on the highway only"). Before, a kick that put one against the rail at the turn-off could send it down the whole old road after you.

- Near the turn-off, a rival's or cop's line keeps off the side it would be handed over on. That holds when it swerves round traffic and in a fight too.
- Shoved onto the turn-off anyway, it brakes and cuts straight back onto the highway in the first stretch, while the turn-off still runs alongside.
- If it misses that stretch, it stops where it is. It never rides the old road on, because rivals and cops cannot turn round. A stopped cop's chase is over, and the heat can send him again on the highway.

The same rule covers every branch a route closes to the field, which today is the Seven Mile's old road, Pacific Northwest's mill-yard cut on the Sawmill Haul and San Francisco's downtown plaza cut. It also covers a branch with a gap that names no share, for every rival who is not bold.

Measured on 12 seeded Seven Mile races, with the dev bot riding the old road and every rival and cop shoved toward the rail again and again as it passed the turn-off (280 to 300 shoves per batch, each at most a kick's 3.6 m):

- Before this change, other riders went onto the old road 42 times, and 12 of them reached its far end, in 9 of the 12 races.
- After it, they went on 4 times, all 4 were back on the highway within 2.4 s, and none reached the far end.
- Over seeds 1 to 40, 22 went on. 19 got back, 3 stopped on the turn-off or the repair platform, and none rode on.
- With no forced shoves, none of the 12 races put a rival or cop on the old road.

Not fixed: a kick in the last few metres before the split, at 35 to 40 m/s, can still beat the way back. The stretch where the turn-off runs beside the highway is only about 26 m long. That rider stops on the platform, which takes it out of that race.

For devs:

- `sim/ai/branches.ts` holds the rule.
  - `rivalNeverTakes` and `lawNeverTakes` are the "never" half of the existing rule.
  - `keepOff` narrows a line's range: out of the split zone on the approach, and 0.9 m inside the barrier limit where the branch overlaps the main road past the split.
  - `wayBack` asks the road's own handover, on a copy of the position, whether a rider pressed to an edge would be handed back onto the main path.
  - The steering cap and gain for the way back are new [default]s, along with an 8 m/s crawl so a bike that is stopped or has just remounted can still steer across.
- `sim/ai/index.ts` (`driveRider`) and `sim/cops/index.ts` (`drive`) both apply it last, so nothing else overrides it. A cop's pursuit burst is cut while he brakes, and his chase ends once he stops past the overlap.
- The rule reads no randomness. In `tests/sim/ai-stay-on-highway.test.ts` the forced shoves come from the test's own seeded stream, and the same seed ends in the same state hash.
- Tests: `tests/sim/ai-stay-on-highway.test.ts` is the band. Each race runs on while any rider is still moving on the old road, so one riding it would reach the far end; against the old code it fails as listed above. The fixture tests in `src/sim/ai/branches.test.ts` and `src/sim/cops/branches.test.ts` cover the way back (control: a branch the rider may take is ridden on), the stop past the overlap, and the line's range.

Not phone-verified, and not seen in a browser.
