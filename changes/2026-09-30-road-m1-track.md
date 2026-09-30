---
kind: new
audience: player
---
The race road is now the real M1 track: about 3.6 km of Keys coastal highway, from the marina, over the Pelican Channel Bridge with its two big humps, and along the Sandbar Causeway to the finish. The bends are proper bends now, both ways, and a race takes a bit under two minutes.

For developers (M1 road-1):

- `src/road/compile.ts` is the road compiler: Catmull-Rom control points in `tools/road/tracks/keys-m1.ts`, compiled with core/math into the baked `json-columns` format at 2 m. Curvature comes from a smoothed heading and positions are re-integrated from it, so position and curvature agree by construction. Bridge humps are smooth 16u²(1−u)² bumps, with grade as their exact derivative. Re-bake with `node tools/road/bake.mjs` (`--check` reports stale files); a unit test fails if the pack files and a fresh compile disagree. It replaces `tools/road/bake-skeleton.mjs`, which is removed.
- `src/road/validate.ts` is the road lint that the pack validator calls (`lintRoadNetwork`, `lintRoad`): sample count and spacing, curvature and grade against positions, `|kappa|·dMax < 0.5`, features, tags and barriers inside the road, road ends within 0.5 m of their junctions, lane widths, network wiring, and route consistency. Each rule has a failing fixture; a GIS-shaped fixture passes it and loads as a route. Its tolerances are `[default]` and live in `ROAD_LINT`.
- New road queries: `curvedRoadRates` (the 1 − kappa·d kinematics with the dir −1 signs), `featuresOf`, `barrierAt`, and `neighbours` now handles joins either way round (a new `sSign` field). Routes expose `checkpoints` and `startGrid`.
- The track keeps the ids other lanes use: network `keys-m1`, roads `m1-marina-run`, `m1-pelican-bridge`, `m1-sandbar-causeway`, route `m1-skeleton-sprint` (the event still names it; renaming it is the event owner's call). Junction ids are now `j-keys-m1-<n>`.
- Features: four `roadsideZone` stretches (marina boardwalk, the bridge's fishing rail, the sandbar beach, a tiki stand), one `copSpawn` beside the start, rails along both sides of the bridge, three checkpoints.
- `tests/sim/road-bot-time.test.ts` prints how long the stub bot takes on the route and fails outside 60–240 s. It is the first file under `tests/sim/`, so the gate's sim-batch step is now active.
