---
kind: dev
audience: dev
---
The dev bot no longer spends most of the 4 seconds after a remount in the far oncoming lane (playtest 4, run C's live check: 2 of 8 remounts away from the Morrison cut, for 191 and 217 of the next 240 ticks, as a fight began).

- **Cause.** Two habits, both in `src/dev/bot`, that #568 left alone because #568 fixed only the Morrison cut's approach.
  - **A car ahead sent the bot across the centre line even with a lane free on its own side.** The bot picked the nearest free lane, own direction or oncoming, so on Bridge City's four-lane road an inner-lane car made the oncoming lane beside it beat the outer lane of its own side whenever the bot was nearer the centre line than the middle of its lane. The bot's header says to pass oncoming only when no lane on its own side is free.
  - **A pass or a line-up that never finishes at a walking pace.** Up from a fall at 8 m/s, the bot takes about 3.7 s to get back to cruise. A pass round a car going nearly its speed, or a kick line-up on a rival on the centre line (the kick spot is on the far side of the rival, in the oncoming lane), spends all of that across the centre line, in front of cars closing at 25 m/s.
- **Fix.** The bot tries every lane on its own side before the oncoming lane. For 300 ticks (5 s) after a remount it keeps to the lanes of its own direction: it takes no oncoming pass (it follows at the blocker's pace when its own lanes are blocked) and lines up on a rival only from its own side. After the window it rides as before.
- **Measured** (Bridge City, the ISOLATED profile with traffic, the bot in the player's seat, the 240 ticks after each remount, ticks more than 0.5 m into a lane that runs the other way). Before, seeds 1 to 24: 52 remounts, 12 spent 19 ticks or more oncoming and 6 spent 100 or more (the worst 196). After, the same seeds: 52 remounts, none spent any (the worst 0). On the game's full field (rivals and cops), seeds 1 to 12: 14 remounts, the worst 0. Done, not phone-verified; the bot only.
- **Rule tests.** `src/dev/bot/bot.test.ts` holds the decisions on hand-built snapshots (3 of its 6 new tests fail on the old bot, the other 3 are controls that pass on both). `tests/sim/bot-remount-own-side.test.ts` replays 6 Bridge City seeds that crossed over before the fix (24 remounts) and asserts at most 60 of the next 240 ticks oncoming after each; the old bot fails it at 119 ticks on seed 9, the first.
- **Budgets.** Dev-bot code and tests only: no render, draw-call or triangle change. First-load JavaScript was not rebuilt or measured here.
