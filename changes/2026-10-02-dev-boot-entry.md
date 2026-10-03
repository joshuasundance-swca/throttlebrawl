---
kind: dev
audience: dev
---
Contract change, landing first and on its own: the lint module map gives dev/ a second public entry, `src/dev/boot.ts`, beside `index.ts`. Only `src/main.ts` imports dev/, and that does not change. The next PR moves the rest of dev/ (the test handle, the bot, the debug report and the perf overlay) off the first-load JavaScript, which has 10.1 KB left of its 500 KB budget: `main.ts` will load `index.ts` lazily and keep only `boot.ts` (the test flag and the error capture) with the first screen. docs/architecture.md's module-map paragraph names both exceptions to "reached only through index.ts" (the sim's `api.ts` and this one). Two new lint cases show main may import the boot entry and still may not reach further into dev/, and ui still may not import dev at all; without the map change the new allowed case fails.
