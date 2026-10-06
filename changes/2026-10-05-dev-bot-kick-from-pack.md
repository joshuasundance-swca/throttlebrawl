---
kind: dev
audience: dev
---
The dev bot now kicks at the kick's real rhythm, read from the kick's own file (playtest 4's combat timing, the leftover from that run).

- **Before.** The bot still modelled the old kick: it led its press by 13 ticks (the old 0.22 s wind-up) and waited 78 ticks between kicks (the old cycle plus its 30-tick cooldown). Since the combat timing change a player's kick winds up in 7 ticks and waits for nothing but the leg's return, so the bot swung at half the pace a player can, and aimed its press for where a rival would be 6 ticks too late.
- **Now.** `KICK_LEAD_TICKS` is the kick's wind-up (7 ticks) and `KICK_REPEAT_TICKS` is its whole cycle (7 + 6 + 33 = 46 ticks), the 4 ticks a landed kick freezes the game for, and 2 spare ticks: 52. Both are computed from `packs/base/weapons/kick.json` the way the sim reads it, so a retune of the kick moves the bot with it.
- **The jab between kicks is gone.** It needed 28 clear ticks before the next kick, and no gap that short is left in a 52-tick rhythm, so it could not fire.
- A rule test in `src/dev/bot/bot.test.ts` ties both numbers to the file: the lead is the wind-up, and the repeat is no earlier than the leg's return plus the hit-stop and no more than 4 ticks after it.
- **Effect.** The bot is used by many seeded sim files, so their fights move; the bands in them are the judge, and none was re-pinned to a lucky seed.
