---
kind: fixed
audience: dev
---
The input browser spec failed at random on a busy CI runner and turned main red: its quick side drag took two CDP round trips, which can exceed the 80 ms gesture window when the runner is loaded. The timed touch gestures now stamp each event explicitly (Chrome carries the stamp into the Pointer Event's timeStamp, which the gesture windows measure) and go out back to back, so their timing no longer depends on round-trip speed. Checked with 12 runs on 4 parallel workers, all passing. The game itself is unchanged.
