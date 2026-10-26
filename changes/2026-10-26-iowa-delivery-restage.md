---
kind: dev
audience: dev
---

The IA 136 delivery-truck ride test no longer hunts for a lucky seed. The authored farm traffic makes a truck going the player's way rare (over 24 seeded rides, 78 trucks spawned but only 5 went the player's way and 1 ride qualified), so the test rode about five full races before finding one. The test now stages its own ride: the farm stretch carries only its delivery trucks, and oncoming traffic runs at half density. Both are content and tuning that the replay file carries. With that staging, 21 of the same 24 seeds qualify, the first seed does, and the test takes about 11 to 17 s locally instead of 50 s, so it is back on the default time limit.

The checks are the same: an input-driven ride, the real finish, a replay with no desync and the same final hash, and a one-tick steering change that desyncs. The test now also checks that the replay header carries the staging, and that the same inputs against the authored traffic do not reproduce the ride. How rare the authored trucks are is still checked by the next test in the file, not this one.
