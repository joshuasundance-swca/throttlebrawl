---
kind: dev
audience: dev
---
The browser test for "cut this" no longer waits on the wall clock to hold a press. It timed a 500 ms long-press with a real timer and failed on main (d1ce742f) and on a bundle train's run when a slow runner stalled the page. The test now sets a flag before load (`__uiLongPressManual`, test builds only) that makes the ticker's long-press count a manual clock, and holds a press by moving that clock (`__uiLongPress.advance(500)`). It still checks the same flow: a touch in the stick zone is ignored, a mouse held 499 ms does nothing and one more tick opens the card with the line on it, confirming cuts it, a touch outside the zones works, and the copied report lists only the cut line. A new unit test (`bubble-press.test.ts`) covers the watcher on the same clock, including the presses that must never cut. The seam is listed in `docs/architecture.md` ("Testing seams"). Production builds keep the real timer. Not phone-verified (no game change).
