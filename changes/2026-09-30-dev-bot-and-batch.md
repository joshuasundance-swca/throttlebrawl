---
kind: dev
audience: dev
---
The test robot now plays for real (M1 dev-1). The `BotController` in `src/dev/bot/` follows the route in its travel lane, pulls alongside a rival and punches it when the rival is inside its window (never the cop), steers around traffic or passes in the oncoming lane when it is clear, holds skip while it is down, and rides a `shortcut` lane once when the road offers one.

`tests/sim/batch.ts` is the shared seeded-race batch: 50 races (seeds 1 to 50) with the bot in the player slot, each replayed in the same run from its recorded inputs. The results are computed once per source tree and cached on disk under `node_modules/.cache/`, so every lane's `tests/sim/<lane>-*.test.ts` asserts over the same races through `simBatch()` without running its own. Each result carries the event log, the field, per-mode tick counts, the hashes and the replay's hashes, the inputs and a trace of every mover every second. `tests/sim/dev-batch.test.ts` asserts that every race ends with a result for the bot, no mover is ever invalid (non-finite, unknown mode, bad road position) and every replay matches, and prints what the field contained. `npm run check` now runs the sim batch step.

The browser race uses the real bot. Its junction check no longer pins the skeleton's edge numbers (road-1 replaces that track): the bot crosses at least one junction and never goes back to an edge. Two assertions switch themselves on and print ACTIVE or NOT ACTIVE with the reason: "an attack connects" once the sim answers attacks (combat-1), and "the bot took the shortcut" once its road has a shortcut lane (road-2). Tried against the unmerged combat-1 and tumble-1 branches: 11 of 11 presses landed in the browser race and 550 hits landed across the 50 batch races.
