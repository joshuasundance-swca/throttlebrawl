---
kind: dev
audience: dev
---
The directional-kick browser test waits out the first kick's cooldown in sim ticks before its second swipe. On a loaded CI runner the second swipe landed while the first kick was still cooling down, so it came out as a punch, as the game intends, and the test failed.
