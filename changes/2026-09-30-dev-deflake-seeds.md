---
kind: dev
audience: dev
---
Two more tests stop depending on how one seeded race turns out. The browser bot race's "an attack connects" check no longer asks only the seed-1 browser race. After that race, the page runs six more seeds headless, using the production bundle's sim, content and bot. Each run stops at the bot's first landed hit. At least 3 of the 7 races must connect; the shared batch connects in 44 of 50. The replay test's "tampered input" check no longer takes the throttle away at tick 1000 of seed 7 without looking. It now picks the first tick from 1000 on where the player is riding with the throttle open. A tick in a tumble ignores the throttle, so nothing desyncs there: a probe on seed 7's tick 1607, mid-tumble, showed no desync. Combat's kick shove moves riders, which could flip either test. The bot's action-to-input conversion is now one exported helper, `botInput`, in `src/dev/bot`.
The self-test's race-running unit tests now carry a 30 s timeout: one ran 5.9 s on a loaded machine, past Vitest's 5 s default.
