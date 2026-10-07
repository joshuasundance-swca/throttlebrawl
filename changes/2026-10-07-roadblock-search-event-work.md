---
kind: fixed
audience: dev
---
The seeded roadblock check now reads each new siren event once instead of rescanning the race's whole event journal on every tick. It keeps the same chronological pursuit rule, seed range, 60,000-tick budget and final roadblock assertion. Each race starts with a fresh counter.

A negative control catches repeated journal reads, and unit checks cover pursuit cancellation, unrelated cops and separate races. The real race still finds the same event at seed 10 after 47,914 ticks. This reduces repeated event work; total execution time remains dependent on the runner, and the timeout has not been raised.
