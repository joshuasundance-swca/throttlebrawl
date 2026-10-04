---
kind: fixed
audience: player
---
Pedestrians wait for a gap instead of walking into you (playtest 3: people on foot should get out of the way, not stroll into the race).

- A pedestrian about to cross checks the road first. If you would reach the crossing before it could get across, it stays on the kerb. It crosses in two steps, kerb to the centre line and centre line to the far kerb, and checks again before leaving the centre line.
- Caught on the road by a rider who turned up faster than expected, it hurries to whichever end of its step is safer, kerb side or centre line. The old dive is still there as the last resort.
- The step-out gag is now a fake-out: a pedestrian lured by a rider coming walks to the very edge of the kerb and stops, then hops back as you go by. It never steps into your lane.
- Big animals (the elk, the gator) wait for a gap too, so they stop walking into racers. Cars do not stop for people, so the dives from cars stay.
- A road zone can now name its own kinds of people. Mallory Square can have its performers and Lombard its selfie tourists without them turning up everywhere else.

For devs: `peds.gapAccept` (0 or 1, on by default; absent means off, and then nothing changes). `roadsideZone` `params.kinds` is documented in `docs/content-packs.md`; the zone rolls from its own seeded stream, so no other zone's spawns move. The per-tick check in `tests/sim/traffic-peds.test.ts` now also fails on any pedestrian stepping onto the road with a rider about to reach it (turned off, it finds 6 in the same five races; on, it finds 0). Over the 50-race batch: 651 pedestrian dives, 0 rider contacts. Not phone-verified.
