---
kind: dev
audience: dev
---
The kick-swipe browser test now waits, after each swipe, until the sim shows the player's attack idle again (at least 1.5 s, as before), instead of 1.5 s of real time alone. On a loaded CI runner the loop steps fewer sim ticks per second, so main's next swipe reached the sim inside the first kick's cooldown and came out as a punch, as the game intends, and the test failed. No game code changes, and every check in the test stays.
