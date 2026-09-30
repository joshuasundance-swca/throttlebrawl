---
kind: dev
audience: dev
---
The test robot now plays for real (M1 dev-1). The `BotController` in `src/dev/bot/` follows the route in its travel lane, pulls alongside a rival and punches it when the rival is inside its window (never the cop), steers around traffic or passes in the oncoming lane when it is clear, holds skip while it is down, and rides a `shortcut` lane once when the road offers one.

`tests/sim/batch.ts` is the shared seeded-race batch: 50 races (seeds 1 to 50) with the bot in the player slot, each replayed in the same run from its recorded inputs. The results are computed once per source tree and cached on disk under `node_modules/.cache/`, so every lane's `tests/sim/<lane>-*.test.ts` asserts over the same races through `simBatch()` without running its own. Each result carries the event log, the field, per-mode tick counts, the hashes and the replay's hashes, the inputs and a trace of every mover every second. `tests/sim/dev-batch.test.ts` asserts that every race ends with a result for the bot, no mover is ever invalid (non-finite, unknown mode, bad road position) and every replay matches, and prints what the field contained.

The browser race uses the real bot. Its junction check no longer pins the skeleton's edge numbers (road-1 replaces that track): the bot crosses at least one junction and never goes back to an edge. Combat has landed, so the browser race now requires that at least one of the bot's attacks connects (seed 1). "The bot took the shortcut" switches itself on once the bot's road has a shortcut lane (road-2) and prints ACTIVE or NOT ACTIVE with the reason. `createStubBot` stays for the lanes whose scenario tests use it.
