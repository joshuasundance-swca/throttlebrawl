---
kind: fixed
audience: player
---
Drifting across from one branch of a fork onto the other no longer throws the bike into the air when the two branches sit at slightly different heights. On Bridge City (the downtown Portland route in review), Broadway's turn-off toward the Morrison Bridge falls away while the main road climbs, and 13 m past the fork they are 0.6 m apart. A rider who drifted across there was lifted that 0.6 m in one tick, the game read the lift as 37 m/s of upward speed, and the bike flew for about 7 seconds and crashed on landing. Every time, for the bot and for a thumb player.

For devs: the move across (`crossToBranch`, playtest 1b) now keeps the rider's vertical speed from before the move instead of turning the height step into speed (`src/sim/riders/index.ts`). Whether a rider is moved across, and where to, is unchanged. Where the other branch is lower, the bike drops onto it from the ground's height with no upward speed.

Checks: `src/sim/riders/handover-step.test.ts` lifts the fixture's turn-off at 8% so the move across is a 0.3 m-plus step up. Before the fix the bike launched on the tick after the move; now there is no jump in the ten ticks after it, and a level move across stays as it was. On Bridge City's branch, `tests/sim/riders-landings.test.ts` went from 2 landing crashes each for the bot and the thumb player to none (72 races; on main's routes alone, 68 races, it passes too: bot 47 clean of 47, thumb 0 landing crashes). Not phone-verified.
