---
kind: new
audience: player
---
San Francisco gets its moving ramp truck. As in the Keys and the Pacific Northwest, a car carrier can now drive ahead of the field in a San Francisco race. Once you are close behind it, its ramp comes down, and catching it launches you off the back. The faster you hit it, the bigger the air. Its four signs read "RAMP-AS-A-SERVICE", "NOW IN BETA", "MOVING FAST", "BREAKING THINGS".

It was held back a wave because switching it on broke two seeded San Francisco tests that checked numbers (a jump count, a fixed time stop), not the rules behind them. Those tests now check the rules instead:

- The Fogline Hill Sprint (`tests/sim/region-sf.test.ts`): every way through the route crosses a crest lip, and every lip the bot rides over at 20 m/s or more throws it into the air, whichever shortcuts its seed takes. The old check wanted 3 jumps from every finisher. A seed that takes the switchbacks and the park cut only passes 2 lips, so it failed.
- The headless career (`tests/sim/career-headless.ts`, all three regions): the bot rides at least the bike the career gives at each event's tier, which is the best step-up bike open there and the one the field is balanced against. Every race must end within a time limit: the route's length at a fifth of that bike's top speed. Before, the bot started San Francisco on the starting bike. It could never buy another, because San Francisco's shop stays shut until the Pacific Northwest's boss falls. Every race also had to end inside one fixed 12-minute stop.

For devs: `tests/sim/career-harness.ts` adds `tierBike`, `onTierBike`, `raceLimitS` and `RACE_LIMIT_SHARE` (0.2, `[default]`). A race's safety stop is the longer of 12 minutes and its limit. `src/career/receipts.test.ts` now reads the rival's and the vehicle's names, and the boards' words, from the packs, so renaming a rider or rewording a template no longer breaks it. The `docs/content-packs.md` moving-ramp paragraph is updated. Not phone-verified.
