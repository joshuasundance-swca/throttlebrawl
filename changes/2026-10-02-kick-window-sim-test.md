---
kind: dev
audience: dev
---
The swipe-kick conversion window is now tested in the sim tier, at exact ticks: a new test (`tests/sim/input-kick-convert-window.test.ts`) rides the race the app builds and sends a swipe's inputs with the kick flag 0 to 15 ticks after the press, then at 16 and 20. Every lag up to 15 turns the punch into a kick that lands or misses, including the lags after the punch has already whiffed; at 16 and later the punch stands. It runs in about 5 seconds. The browser test used to check this with a real-time swipe that landed in the 7 to 15 tick window only when the runner's load allowed it, with up to four tries (39 failures on 2026-10-02). It now keeps the touch paths only: the burst swipes kick, and a swipe whose end reaches the page after the press was sampled still sets the kick flag. Its fixed 1.5 s wait between swipes is gone too; it waits on the sim's attack phase instead.
