---
kind: dev
audience: dev
---
Tests that broke whenever a lane added content now check the rule they exist for, so a new road, region, station, sign or traffic type no longer means editing someone else's test. Since 10-03, 13 of 28 red PR runs were fixed by editing a test like these.

- Regions and routes are read from the packs: every region is offered, in chapter order, with its own words (`tests/sim/app-regions.test.ts`, `src/app/regions.test.ts`). Every real road is raced, and a route that no race offers fails (`tests/sim/road-real-routes.test.ts`).
- San Francisco's region lists every network it has. Each race field is the event's rivals, the player, then the region's cops taking turns, as many as the event's cop block asks for. Each traffic type weighs what its region file lists, or 0 (`tests/sim/region-sf.test.ts`, `src/app/config.test.ts`).
- Each radio dial holds the region's own stations from the packs (`src/app/regions.test.ts`, `src/audio/radio.test.ts`). The hand-made Keys roads are the ones on disk (`src/content/content.test.ts`).
- Counts follow the packs: the road-event signs (17 and 3 become "every sign", with the number printed) and the log truck's logs (`src/render/event-signs.test.ts`, `tests/sim/events-moving.test.ts`).
- Every region sign and billboard has a slot somewhere on its region's roads. That is now checked once, in `tools/road/board-slots-on-land.test.ts`, so the Keys, Pacific Northwest and San Francisco track tests no longer keep whole-region lists or district prefixes. The Keys track's edge count and lanes check follow its network and its longest route.
- The road-events browser spec no longer names a seed for each race. Each region tries seeds 1 to 16 in order until it has met every piece. It fails only if no seed brings a piece up.
- `docs/engineering.md` (the gate) now says to assert the rule, not a whole-game list, a count, text copied from a pack or a lucky seed.

Every changed check was shown to fail on a broken rule before it was restored. Budgets, determinism, replay, layout, geometry and reachability checks are unchanged.

Also: `tests/e2e/dev-selftest.spec.ts` no longer waits a fixed 5 s for the self-test panel to appear, which timed out once on main (2026-10-04). It now waits on the panel's own done signal (`data-status`), under the spec's existing 90 s hang guard.
