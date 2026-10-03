---
kind: dev
audience: dev
---
Lint now stops new browser tests from waiting on the clock. In `tests/e2e`, `waitForTimeout` is banned, and so is any `setTimeout` or `setInterval` whose delay is not a literal of 100 ms or less. A test waits on the game instead: a race tick, something on screen, the fast-forward, or a number of drawn frames (a new `frames()` helper).

Of the 47 existing waits, 9 became frame or tick waits: the "the race stands still while paused" checks in the phone, pause and settings tests, two frame waits, and a 4 s wait in the camera test. Each converted test passed locally. The other 38 are allowed line by line with their reason. Most really are about wall time: long-press thresholds, UI timers, the audio clock and the slow-frame watch. 6 are marked "debt" because they stand in for game progress and should become tick waits. Since then the kick-window and style pop-up rewrites (#365, #366) removed three of those waits, one of them debt, so 35 are allowed and 5 are debt. A unit test proves the rule fires on each banned form and stays quiet on short polls, on allowed lines and outside `tests/e2e`.
