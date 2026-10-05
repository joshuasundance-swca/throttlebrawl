---
kind: dev
audience: dev
---
A flaky browser check is steadier: the tilt sensitivity probe in `tests/e2e/ui-settings.spec.ts` waited 800 ms of wall clock for the tilt filter to settle, and on a loaded CI browser it read 66 to 69 where it expects 73 plus or minus 4 (it failed #500 and #506, neither of which touches input). It now waits for 60 sim ticks, a second of game time, as AGENTS.md asks of every test. Run keeper fix; nothing in the game changes.
