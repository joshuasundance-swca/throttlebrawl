---
kind: dev
audience: dev
---
dev-4, first part. The copied debug report now says what the race was played with: difficulty, assists, throttle mode, speed, slow motion, length and steering. It also has a line for the saved race, meaning its replay key and tick, a refused key, and the fast-forward time. Until app-4 wires the saved race in, that time is an estimate from the live sim step. The `?debug=1` overlay shows the estimate too, as `6-min ff ~X s`, so a phone can read it now. The shared seeded batch gains 20 Easy and 20 Hard races (`presetBatch`), cached like the Normal batch, and a small hook registry (`tests/sim/hooks/`) so lanes can add per-tick numbers without racing on their own. The M2 bot checks that wait for combat-4 print NOT ACTIVE: a takedown by the bot, slow motion in the batch, and the perf run's slow-motion checkpoint. Finding for riders-5: over 20 seeds, rivals hit the player a little less on Hard than on Easy (189 against 208). Cop spawns do rise, from 9 to 20.
