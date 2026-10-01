---
kind: fixed
audience: player
---
The punchy launch now works with a normal thumb on the phone. It used to kick in only with the touch stick pushed nearly all the way up, so a thumb held at 85 % still took almost 8 seconds to reach 60 mph. Now the punch grows smoothly with the stick: 85 % reaches 60 mph in about 3.5 seconds, 70 % in about 4.4, and full stick, auto-throttle and the keyboard are unchanged at about 2.9. The rivals and the cop ride as before.

For developers: a player's launch punch has no throttle gate; an AI rider keeps the 90 % gate (`AI_LAUNCH_THROTTLE`), so its speed holds are unchanged. Three tests moved with it, in the open. The combat steal test now picks the first seed whose rival reaches a roadside pipe first and counts only the cues the player meets empty-handed (with the faster launch, seed 3's player rolled over the pipe first, and a rider holding a pipe cannot steal one). The airtime test's slow crawl off the lip rides without the punch, so it is still a crawl. The lower-overall-speed jump check now takes the median of eight starts spread over one tick (a single flight's peak swings by up to half with where the lip falls inside a tick, and the punch moved the one start off its lucky phase).
