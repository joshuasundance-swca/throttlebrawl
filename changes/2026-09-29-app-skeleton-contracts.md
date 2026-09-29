---
kind: dev
audience: dev
---
The walking skeleton (M1 app-1) puts every module behind its public index.ts and fixes the M1 contracts: `src/sim/api.ts` (SimInput, SimSnapshot, SimEvent with attackStart and attackMiss, SimConfig with difficulty, createSim, sim.hash, sim.applyParam and the aggregated SIM_TUNING list), `src/sim/world/` (entity store, tick order controllers, riders, combat, cops, traffic, peds, tumble, race, modifiers, then the event flush), `src/core/`, and the content schema folder with Zod schemas for the M1 minimum. From here, contract changes go in small contract PRs.

Two `[default]` doc additions, both to record how the skeleton works rather than to change a design: architecture.md's dependency rules now say that `src/sim/api.ts` re-exports the core and road types that modules without a drawn edge to core need (app, ui, render, camera, audio, replay and dev), and that stream/ builds the road network handle; content-packs.md now describes the pass-through join (a junction with two road ends and no connectors), which the skeleton track uses.

The skeleton track is a stopgap baked by tools/road/bake-skeleton.mjs (three roads, 2.5 km); road-1 replaces it. The first perf numbers are in tests/perf/baseline.json, and budget.json gains the 120 draw-call and 150k triangle limits.
