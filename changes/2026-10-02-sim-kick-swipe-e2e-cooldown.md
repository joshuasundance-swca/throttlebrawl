---
kind: dev
audience: dev
---
The kick-swipe browser tests wait out the player's last kick, cooldown included, in sim ticks before each swipe. On a loaded CI runner a swipe twice landed while the previous kick was still cooling down, so it came out as a punch, as the game intends, and the test failed.
