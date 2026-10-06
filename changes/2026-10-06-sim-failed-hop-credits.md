---
kind: fixed
audience: player
---
Missing the Seven Mile's old-road hop no longer shows FOUND IT. If your bike leaves the ramp too slow, falls into the water and wakes on the highway, that is a respawn, not a shortcut you found, so the stamp stays quiet. This holds at both hops (the turn-off onto the old road and the one back onto the highway). A clean ride of the old road still gets its FOUND IT, once.

Airtime was already paying nothing for a fall: the sim scored no cash for a flight that ended in a crash or a splash. What you saw while falling was the live meter counting up what the jump would pay if it landed ("AIRTIME 1.3s +$40"); it vanishes when the bike goes in, with no cash. Left as it is, because the meter cannot know a jump will miss until it does.

For devs: `[default]`, not phone-verified, no browser run. `src/sim/race/shortcuts.ts` drops a rider's timed shortcut run on a `respawn` event instead of stamping it. `tests/sim/keys-seven-mile-failed-hop.test.ts` rides the real Seven Mile: both misses (the east hop at 23 and 12 m/s, the west hop braked over the last 230 m of the old bridge) fail without the fix with a `shortcutFound` on the respawn tick, and pass with it. Its controls: a clean ride of the whole old road still stamps once and its three clean landings still pay $40; the 12 m/s east run also pays its legitimate clean landing on the platform before the fall, and nothing for the fall. No budget touched (sim-only change, no render or bundle change).
