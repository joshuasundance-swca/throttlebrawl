---
kind: dev
audience: dev
---
The route picker's browser spec no longer lists every region's routes by hand. It was the test most often broken by a content PR: each new real road meant editing it. Now it reads what each region should offer from the packs on disk: the region's own road first, then every route on its map-data networks and its other hand-made networks, in id order. A newly baked road shows up without a spec edit. It still checks each chip's name, its route, the order, the default pick, the 44 px touch targets, the phone fit and the real-road blurb.

- `tests/e2e/packs-on-disk.ts` is the plain-JSON reader that browser specs can share (regions in menu order with the event a pick races, and the routes the picker offers).
- `tests/sim/e2e-oracles.test.ts` checks that reader against the game's own `regionChoices`, `realRoutes` and `routeChoices` over the same packs. If the rule changes, it fails in seconds, before the browser tier runs.
- The Twin Peaks race test takes its region and event from the packs. Its seed, its route and its replay check are unchanged.

Before it was restored, each oracle check was shown to fail on a broken rule: once with `realRoutes` dropping the other-network clause, and once with `regionChoices` picking career events first. The spec itself was not run locally, because lanes run no browser. CI runs it.
