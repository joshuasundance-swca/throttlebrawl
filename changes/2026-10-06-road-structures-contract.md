---
kind: dev
audience: dev
---
The physical world's contract, ahead of the work that makes buildings solid (the maintainer, 2026-10-06: "consistent physics and gameplay is important here so players know what to expect and how to interact with the world"; he accepted a road race in a physical world with honest edges: "Yeah that sounds good :)"). Nothing in the game changes yet: nothing reads the new code.

- `src/road/structures.ts`: a structure is one solid, an oriented box in world metres with a base (its underside) and a flat or pitched roof. One plan per network and seed, made by the layers the network needs (each a planner that loads as its own lazy chunk), kept, and read by both render and the sim; a network whose layers are not all planned refuses to start a race (`requireStructures`). A placed model's box comes from a fixed table by model id (`STRUCTURE_MODELS`), never from what has loaded: today's 18 rows are downtown Portland's kit and Key West's Old Town fronts and bars, the two layers whose lots render sizes from the loaded model. `scripts/hitboxes.test.ts` holds each row to its committed GLB within 1 cm, and the Portland rows to the lots `pdxFootprint` measures today (18 boxes from 3 models, 10 lots; a row 2 cm off fails).
- `src/road/course.ts`: `courseAt` says what a rider at a point would come down on: his own road's lanes or verge band, another road's (projected onto it), or a structure's top, the highest at or under him, or out of bounds.
- `docs/product-spec.md` ("World frame") records the decision as [decided], and `docs/architecture.md` gets a "Physical world" section: the contract, the plan-sharing rule, the lazy loading and the order of the run.

Tests: `src/road/structures.test.ts` and `src/road/course.test.ts` (17 tests; a turned box and an axis-aligned one, the road plane past the band, a missing planner, the highest support under a deck, among others). Each was written first and failed for the missing module; a box test made axis-aligned and a course test that ignored the band each failed. Not phone-verified (no game change).
