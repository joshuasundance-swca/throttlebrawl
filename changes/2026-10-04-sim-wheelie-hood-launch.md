---
kind: dev
audience: dev
---
The sim now rides the wheelie and the hood launch (playtest 3: "if you wheelie into the hood of a car it should launch you up into a jump doing backflips"). The player can't pop one in a race until the double-tap gesture lands (task T2.2); until then nothing in a race changes.

- `src/sim/riders/wheelie.ts` fills the contract's hooks: the pop on the wheelie flag's rising edge, the throttle balance with its sweet band, a loop-out crash, a slammed front's wobble, and a `wheelieEnd` for every end. While up, steering has 0.6 of its reach and the snapshot's `pitch` is the bike's real pitch. `riders.wheelie` (on) and `riders.wheelieGain` are new tuning keys.
- A wheelie into a car (a sedan, pickup, van, robotaxi or stalled car, oncoming or the trunk ahead) launches the rider into 1 to 3 backflips instead of a crash, and the car brakes. A parked pickup launches too. The backflips are a scripted spin in `air.ts` that hands back to the normal air rules for the last half turn.
- Two numbers differ from the spec, both computed: the rear brake's pull is 26, not 12 (at 12 it misses the spec's own brake test), and the launch's rise is capped by a 9.5 m apex instead of 14 m/s (14 m/s came down at 14.7 m/s, a landing wobble every time).
- Two small shared edits in `src/sim/riders/index.ts`, because the contract's hooks could not do it alone: a launch off a parked car ends the riding tick (the rest of that tick wrote the rider back onto the road), and the `land` event carries `hood`, which sim/race already reads for the hood trick's ×1.5.
- `docs/architecture.md` ("Jumps, ramps and airtime") describes it. New tests: `src/sim/riders/wheelie.test.ts` and `tests/sim/wheelie-replay.test.ts`.
