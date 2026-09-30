---
kind: dev
audience: dev
---
The build now bakes the self-test race's result into the game (for dev-2's `?selftest=1`): a small plugin in `vite.config.ts` runs `src/dev/selftest/race.ts` in Node through Vite's module runner and serves the result as the virtual module `virtual:selftest-expected`. Until that race file exists the module is `null`, which the self-test shows as "not built".
