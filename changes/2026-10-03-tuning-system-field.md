---
kind: dev
audience: dev
---
Tuning declarations can now say `system: true`. The flag marks the switch of an optional world system: traffic, animals, road events, the event's cops, the patrol, the heat meter, off-road riding, and the roadside and crash weapons. Nothing in the game reads it, so play and replays are unchanged. It is the contract half of the determinism work. A follow-up PR adds an isolation profile for seeded sim tests that turns every marked system off, plus a guard test that fails when a marked switch is missing from that profile. A test of one behaviour then stops changing when an unrelated system lands. This PR marks nine declarations, and the declarations test checks that each one affects the sim.
