---
kind: fixed
audience: player
---
Getting back on your bike next to stopped traffic no longer crashes you again straight away, and slow bumps into cars, trucks and buses now make you wobble instead of crash. When you remount after a crash, or come back after going over a rail, your bike is a ghost to traffic for a moment. You ride straight through any car, truck or streetcar in the way. This lasts at least 1.5 s, carries on while you are still inside a vehicle, and never lasts more than 4 s. Your rider looks slightly see-through while it is on. Rivals, cops, walls and the road's edge still count as normal. Every bump with a vehicle is now decided the same way: by how fast you and the vehicle come together. Under 10 m/s (about 22 mph) it is a wobble, whatever you hit and whether you were already wobbling. At 10 m/s or more it is a crash. So a head-on, or rear-ending a car at racing speed, still throws you off, but rolling into a stopped car does not. Your respawn spot has not moved. Traffic behaves as it did before.

Measured with the test bot over 60 seeded career races, 10 seeds each of two races per region (Keys: The Shakedown, The Long Haul; Northwest: Bridge City, Fogline Run; San Francisco: Hill Sprint, Burn Rate):
- **Crashing again within 5 s of getting back on the bike:** this fell from 35 of 605 restarts (5.8 %) to 10 of 442 (2.3 %). Traffic caused 34 of those before and 9 after.
- **Crashing again within 1.5 s:** this fell from 16 to 0. Seven of the 16 came on the very first tick, from remounting at 8 m/s against a box truck, a pickup, a streetcar, a log truck or the San Francisco event's runaway cable car (three times). Five of those seven vehicles were standing still. Before this change, touching any truck crashed you at any speed, and so did touching anything while you were still wobbling.
- **Crashing again in the Northwest:** the worst region, it fell from 10.3 % of restarts to 2.5 %.
- **The 9 traffic crashes that remain after a restart:** all came 2 to 5 s after the remount. Seven are head-ons at 26 to 54 m/s closing speed, with a rider in the oncoming lanes. One is a rear-end at 38 m/s. One is a rider hitting a stopped car at 11.5 m/s.
- **Crashes overall:** these fell from 617 to 448, and traffic crashes from 400 to 263. Traffic wobbles came to 414. The before figure for wobbles was not counted on this set.
- **The shared batch's Keys race (50 seeds):** traffic crashes fell from 146 to 107, traffic wobbles rose from 89 to 114, and crashes within 5 s of a restart fell from 6 of 233 to 2 of 184.

For devs:
- **The one rule:** `src/sim/traffic/contact-rule.ts` (new) holds `trafficContactCrashes` and `closingOnAxis`. The tuning key stays `traffic.solidHitMps`, and its default goes from 6 to 10 m/s.
  - `contacts()` in `src/sim/traffic/index.ts` measures the closing speed along the road for an end-on hit, and across the road for a side brush or a graze. It uses the rider's heading plus a kick's shove still in progress (read from combat's state by name, so traffic does not import combat), and the vehicle's sideways rate, which is a new `cdMps` per slot.
  - The `big` rule and the "already wobbling" rule are removed.
  - The light kerb riders keep their soft contact, and its topple still uses the along-road speed difference. The wheelie trunk launch (#525) is unchanged.
  - `src/sim/riders/index.ts` runs ramp trucks (fixed and moving) and parked pickups (`object: pickup`) through the same rule and key. A stump keeps the barrier line (`riders.crashImpactMps`). Riding into a ramp truck's body from up on its deck still always throws you.
- **The ghost:**
  - `startTrafficGhost`, `trafficGhost` and `stepGhosts` are new in `src/sim/traffic/index.ts`. The timers count scaled ticks. `traffic.respawnGhostS` (1.5 s) is a new tuning key, and setting it to 0 turns the ghost off. The ghost stays on while within `ghostClearM` (0.25 m) of any vehicle, up to `ghostCapS` (4 s).
  - While the ghost is on there is no contact, no push and no near miss. Cars still brake for the rider.
  - The tumble system calls it from `remount()`, which covers the run-back, the skip and the splash respawn. The snapshot gains an optional `ghost` field.
  - `src/render/riders/ghost.ts` adds `respawnOpacity`. `src/render/riders/index.ts` adds a per-rig "fade" material: a copy of the look's own rider material that keeps the look's shader patch and stays see-through at 0.5 to 0.8. It applies only to the player's slot. This render change rides here, outside the sim lane, because the brief asked for the cue in the same change.
- **Tests:**
  - `src/sim/traffic/contact-rule.test.ts` (new) covers the geometries, both sides of the 10 m/s line, a side swerve into a car and into a truck, a kick's shove, the ghost riding through a stopped car and then meeting the next one solid, the minimum and the cap, the snapshot flag, and the hash.
  - `tests/sim/traffic-respawn-ghost.test.ts` (new) runs over the shared batch through a new hook, `tests/sim/hooks/respawn.ts`, plus four Northwest and San Francisco races. Its hard rules are: no traffic touch while a ghost, no ghost cut short, and none past the cap. It also checks that one race replays to the same hash, and that crashes within 5 s of a restart stay under a 5 % band (the reasons are in the file). On the old build those four races fail the hard rules on all 34 restarts.
  - Rewritten by the new rule: the side-brush test in `traffic.test.ts`, and the moving ramp truck's "ordinary big vehicle" test in `tests/sim/events-moving-ramp.test.ts`. Both now check that closing over the line crashes and closing under it wobbles.
  - Also new: a parked-pickup case in `hazards.test.ts`, and ghost checks in the tumble tests.
- **Docs:** `docs/architecture.md` (Traffic and Crash tumble) is updated.

Not phone-verified. The see-through cue was not looked at in a browser.

Seen but not changed (the dev bot's lane): on Bridge City seed 2 the bot steers into the oncoming lanes about 2 s after each remount and hits cars head-on (3 times in one race).
