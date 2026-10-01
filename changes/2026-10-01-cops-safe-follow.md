---
kind: fixed
audience: player
---
The cop no longer sails past you and then creeps away along the shoulder when you slam on the brakes. Hanging back, he now keeps a real stopping distance, so he stops behind you; and if a hard stop carries him past while he is pulling alongside, he pulls onto the shoulder and waits for you to come by. He still launches the way he always did; a new "Cop launch punch" slider can give him the riders' punchy launch.

For developers: sim/cops' hang-back speed is capped so he can stop `STOP_BEHIND_M` (8 m) short of where his target could stop at full brakes, braking at `STOP_BRAKE_SHARE` (80 %) of his own, with the braking fed forward; moving in alongside, the same cap applies once the target brakes, aimed at alongside; and a move-in ends when he is carried past. New tuning `cops.launchShare` (0 to 1, default 0) is how much of `riders.launchGain` he gets (the cop declarations test now lists thirteen). Tests: hanging back 40 m and 15 m at top speed, and the chase with the share at 1, braking at 6 to 20 s (before the fix: carried 71 m past at 8 s, then crawling on). The long Keys race in `tests/sim/road-lengths.test.ts` now tries seeds 1 to 3 until the bot finishes, every miss a bust (with the share at 1 the dev bot, which never evades the cop, was busted on all three seeds).
