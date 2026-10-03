---
kind: dev
audience: dev
---
The browser bot race no longer fails when a crash throws the bot back across a road join. It used to require that the bot never enter the same road piece twice, but after a crash the rider can land on the piece behind, get back on and ride forward over it again, which is the game working (one CI race went 0, 11, 12, 13, 4, 5, 4, 5 after nine crashes). The test handle now watches every tick and counts only a ride from one piece back onto a piece it reached earlier while riding on both ticks; tumbling, the run on foot and the forward ride after getting back on do not count. The race must show none of those, and a finished race must end on the furthest piece it reached. Unit tests prove the watch passes the crash cases and fires when the bot really rides backward.
