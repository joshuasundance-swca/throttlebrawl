---
kind: new
audience: player
---
A bike that is smoking is now a little slower. When a rider is down to a third of his health or less, the bike trails smoke as before, and it now also tops out about 7.5 % lower while it smokes (a 100 mph bike gives back about 7 mph). It is gentle on purpose: the bike still accelerates the same, and the speed eases down rather than snapping. It applies to rivals who are smoking too, so what you see smoking is slower. Every race starts with every bike repaired, so in the career the next race is a fresh bike, and your own health coming back over the line lifts the slowdown mid-race.

For devs: the new tuning key `riders.smokeSlowdown` (0.075; 0 turns it off; the decided range is 5 to 10 %) in `src/sim/riders/smoke.ts`, applied to the bike's own top speed in the grounded and airborne models and the touch-down forecast. `SMOKE_HEALTH` (0.34) now lives in the sim and the render imports it through `src/sim/api.ts`, so the smoke and the slowdown cannot drift apart. `docs/product-spec.md` (combat) is updated. Tested by sim ticks in `src/sim/riders/smoke.test.ts`. Not phone-verified.
