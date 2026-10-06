---
kind: dev
audience: dev
---
The dev bot no longer rides into the oncoming lanes after it gets back on its bike (playtest 4, the respawn lane's finding).

- **Cause.** The bot's route-planner takes road-2's ramp shortcut by moving into the split zone for the 150 m before it. Bridge City's cut leaves from the oncoming side, so that line runs through the lanes that go the other way. A bot that fell in that approach got up at a walking pace, still on the plan, and spent about 3 s in those lanes while it sped up, in front of cars closing at 25 m/s.
- **Fix.** Back on the bike inside the approach to a zone whose line crosses the oncoming lanes, the bot gives that zone up and rides its own side. A zone on its own side (the road-2 ramp), and one still beyond the approach, are kept.
- **Measured** (Bridge City, the ISOLATED profile with traffic, the bot in the player's seat, seeds 1 to 10, the 240 ticks after each remount; seed 2, the one in the finding, no longer falls at all on today's main, so the other seeds show it). Before: 25 remounts, 6 of them crashed (all on the main road, in the oncoming lanes), and 18 spent 100 ticks or more in the oncoming lanes. After: 28 remounts, none crashed, and 3 spent 100 ticks or more there (each was a pass round a blocker, which the bot only starts when the oncoming lane is clear for 160 m; I did not trace those three one by one).
- A rule test in `src/dev/bot/bot.test.ts` holds it: a remounted bot steers to its own lane and stays there.
