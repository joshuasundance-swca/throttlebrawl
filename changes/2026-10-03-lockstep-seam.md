---
kind: dev
audience: dev
---
Browser tests can now run the game in lockstep: a set number of race ticks in every drawn frame, whatever the time between frames. A fast-forward rides many ticks a frame until something in the race happens, then drops back to a few ticks a frame. Until now a whole race in a browser test ran at the speed the test machine could draw, which on CI's software renderer is 7 to 19 frames a second, so every race test waited minutes and failed whenever new content made a race longer. Nothing changes for players: the switch only exists for the test handle, behind the test flag, and the race itself is stepped exactly the same way at any speed. The browser specs move onto it in a follow-up change.
