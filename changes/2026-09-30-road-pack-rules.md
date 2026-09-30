---
kind: dev
audience: dev
---
`npm run packs:check` now runs the road lint on every road network in the packs, as a hooked rule (`tools/road/pack-rules.ts`, rule `roads`). That covers samples, curvature, grade, width, features, junctions and connector rows, split zones, the jump rule and routes. On the base pack it examines 2 networks and 14 roads (the M1 track and the GIS stretch) and finds nothing. A broken road is reported against its pack file with a JSON pointer, as `road-<rule>`.

To make that work, one fix outside the road lane: `tools/packs/check.mjs` now imports a small `tools/packs/cli.ts` that runs the check while it is being imported. Before, the Vite module runner closed as soon as `run.ts` was imported, so any hooked rule module failed to load on the command line with "Vite module runner has been closed". Hooks only worked under Vitest. A test runs the real command line and checks that the `roads` rule is listed with 0 errors. Without the fix, that test fails.
