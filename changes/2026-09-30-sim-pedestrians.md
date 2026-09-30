---
kind: new
audience: dev
---
Pedestrians at the roadside (M1 traffic-2). Tourists with coolers, fishermen on the bridge rail and the odd free-range chicken hang around the boardwalk, the beach and the tiki stand. Some of them wander across the road, often just as you arrive. Ride at them and they dive clear in a short cartoon arc, lie there a moment, then get up and shuffle off the road. They dive earlier the faster you come, and they dive out of the way of cars too. Nobody gets hurt.

The three kinds (Tourist With Cooler, Fisherman, Chicken) ship as `draft`, like the traffic vehicles, so dev and staging builds have pedestrians and the public game does not yet. The reason: with pedestrians in the field the rivals swerve and brake a little differently, and `tests/sim/ai-rivals.test.ts` (the ai lane's) has almost no headroom. Its slowest rival already finishes 29.5 s after the winner, against the 30 s race-end timeout, so any change to the field tips one of its 200 rival results into "still running". With the kinds `live`, it failed 1 to 3 of 200. Flip them to `live` together with the traffic vehicles once that check has room (see the traffic-2 lane report).

How it works: `src/sim/peds/` spawns pedestrians from every `roadsideZone` feature at race start, off the drivable road on the zone's side. There is one per 25 m of zone, at most 4 per zone, which gives 15 on the M1 track. About half cross the road and come back after a seeded wait, and the rest loiter. Nobody crosses where a rail or wall lines the road. A waiting crosser may instead step out as the player comes, 10 to 50 m beyond the player's threat range (a 0.6 chance per wait). That is the worst-moment gag, and it makes dives frequent enough to see; rivals and the cop do not trigger it.

The threat range is `6 m + speed × 1.1 s` ahead (47.8 m at 38 m/s), inside a side band of both half widths plus 1.6 m. A threatened pedestrian dives 3.5 m sideways in 0.5 s with a 0.8 m arc and emits `pedDive` (`data.side` +1 is toward +d; the threat is the `target`). It picks the side with the most clearance from every rider and car nearby while they pass, and it prefers to land off the road. A contact still counts, and it knocks the pedestrian into a dive (`data.bumped`). A `big` kind crashes the rider instead (a `crash` event with `data.cause` `ped`). A walking pedestrian never steps closer to a rider or car that is right beside it. Rolls come from the `peds` stream only. All numbers are `[default]` starting values in `PEDS`.

Choices made here, all `[default]`:
- Pedestrians also dive from traffic cars, because cars do not brake for them and would drive through them.
- A `pedestrians` zone gets the odd stray animal (1 in 5), so the chicken shows up on the M1 track.
- The kinds are picked evenly. `SimConfig` does not carry the region's weights yet (the same gap as the traffic mix), so the region file lists them all at weight 1.

Tests: the scripted tests are in `src/sim/peds/peds.test.ts`. `tests/sim/traffic-peds.test.ts` asserts over dev-1's shared 50-race batch. Every race has pedestrians who dive, and no `pedDive` marks a rider contact. On five of the batch seeds it also checks every tick from the snapshots, using only the public numbers. No rider box ever overlaps a pedestrian box. Every tick where a pedestrian is inside a rider's threat range has a `pedDive` for that pedestrian within one dive's length.
