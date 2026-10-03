---
kind: dev
audience: dev
---
Seeded sim tests get two tools so that another system's merge stops turning them red.

- `ISOLATED`, in `tests/sim/batch.ts`, is a tuning profile with every optional world system off: traffic, animals, road events, the event's cops, the patrol, the heat meter, off-road riding and crash weapons. Roadside weapons go as sparse as the slider allows.
  - A test of one behaviour starts from it and turns back on only what it tests.
  - A new guard test fails when a declaration marked `system: true` is missing from the profile.
- `firstSeed()` finds the first seed whose race contains what a test needs, such as a bust or a steal, and prints the seed it used.

Three tests use them now:
- The weaver test compares quirks on and off in isolation. Dial-Up's clear-road sway reads 0.84 against 0.61 m/s (a ratio of 1.38 against the 1.15 floor). The ten-race ratio used to read 1.16 to 1.25, and two unrelated merges once pulled it to 1.12.
- The landings count runs isolated except for the ground beside the road. It also got cheaper: 66 s locally, against 290 s on CI before.
- The law checks find their steal and their bust with `firstSeed`.

The trade-off: statistics measured in isolation no longer catch interaction effects, so docs/engineering.md says which tests keep the world on and why. The heat roadblock test stays as it was. Under the isolation profile, the Pacific Northwest's bot never raised any heat, because heat comes from chaos, and chaos comes from interactions.
