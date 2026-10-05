---
kind: changed
audience: player
---
Rivals now hit harder as a region goes on. In the career, a rival's blows on you are about 10% softer at a region's first tier, as hard as before by its second, and about 12% harder by its last (never more than 15%, even in later seasons). Before this, the climbing "hits harder" number was set but never reached your fights, so a last-tier rival swung exactly like a first-tier one. Free riding, cops, your own hits and rivals fighting each other are as they were.

For devs: the field level's power scale now rides in its own `SimRiderDef.levelPower` (`src/app/config.ts`, left out when it is 1), apart from a rival's own `power`, and `src/sim/combat/index.ts` multiplies a rival's hit on the player by `1 + (levelPower - 1) × combat.levelPowerOnPlayer` (default 1), at most `combat.levelPowerMax` (1.15). Both are tunable, sim-affecting parameters. A rival's own `stats.power` still reaches the player only by `combat.powerOnPlayer` (0), so playtest 1 item 7 holds. Two new tuning entries change the hash of every race in absolute terms, as any new sim parameter does; a level of 1 (or no level) gives the same hash as before for the same tuning, which `src/sim/combat/rival-climb.test.ts` pins.

Checks: `src/sim/combat/rival-climb.test.ts` pins the rule on a rival's kick (18 data damage): a level of 1 or none leaves damage and world hash as they were, 1.12 gives 20, 0.9 gives 16, 1.3 is capped at 1.15 (21), the gain and cap are tunable (0 switches it off), and the player's hits and rival-on-rival hits never take it. `tests/sim/app-field-level.test.ts` checks the level reaches each rival as `levelPower` and that a power scale of 1 builds the rider as the file has it. Not phone-verified.
