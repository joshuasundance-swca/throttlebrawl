---
kind: dev
audience: dev
---
The four whole-race browser tests no longer race against the clock. The bot race, the main race screen test, the real-road route test and the road-events test used to let a whole race play in real time inside a wait of up to nine minutes. The CI machines draw 7 to 19 frames a second, so every longer race pushed one of them over its limit. On 2026-10-02 the brittle-test inventory counted 69 failures of the first three, and it blames whole-race tests for six browser jobs that hit their time limit.

Now the bot race rides in lockstep: exactly 8 race ticks per drawn frame, every frame drawn. It checks that every frame stepped exactly 8 ticks and saves the race's debug file. The other three skip ahead through the parts they do not check, stopping on the exact tick their check needs. All their waits are now hang guards.

A Node bot race started from the browser race's debug file gave the same inputs and state hashes for all 8,726 ticks, at both 7 and 8 ticks a frame. So a skipped-ahead race is the same race, and a browser failure can be replayed in Node.

The race screen test now checks the target bar on every drawn frame instead of every 100 ms of wall time. Its first CI run missed by one (209 of 210): seed 110's race ended on the last tick of a frame, and the frame that ends a race goes to the results screen before the bar can be checked. The count now leaves out that last frame and reads the start tick and the sample count in the same step, so no frame can slip between them. Locally (one worker, software rendering) the four specs took 47 s, 22 s, 32 s and 32 s. The CI timing table (`tests/timings.json`) lists the bot race, race screen and route specs at 826 of 2,564 browser seconds; road-events has no entry there. The table needs a re-measure once this lands.
