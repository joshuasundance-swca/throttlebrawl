---
kind: dev
audience: dev
---
The sim contract gets one new style kind, `roofRide`, ahead of the lane that lets a rider land on a vehicle and ride on it (the maintainer, 2026-10-06: "land on it and ride on it with real physics"). That lane pays a small style bonus for a ride on top of a vehicle, by the second, when the rider leaves it; this change only adds the kind to `STYLE_KINDS` in `src/sim/types.ts`, its ticker word `ROOF RIDE` in `src/ui/race-feed.ts` (`src/ui/race-feed.test.ts` holds every sim style kind to a word), its receipt label `Roof rides` in `src/career/settle.ts` and its objective word `ROOF RIDES` in `src/career/race-log.ts` (so a career receipt never shows the raw kind), and the kind to the list `src/sim/events-m2.test.ts` pins. Nothing emits it yet, so no race changes. Contract changes land first, as their own PR (AGENTS.md).
