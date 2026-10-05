---
kind: dev
audience: dev
---
A sim test stops timing out: the Pacific Northwest roadblock check in `tests/sim/cops-law-personality.test.ts` searches seeds for a race where a cop already chasing is radioed ahead to a roadblock. Since playtest 3 wave C the first such seed is 9, and nine full races ran 90 to 104 s on CI, over the sim tests' 90 s default (the CI-layout PR #486 failed on it). Each race now stops once the roadblock fires, and the test has its own 300 s timeout, enough for the whole search to seed 24. On the dev machine it now runs in 48 s (seed 9). Run keeper fix; nothing in the game changes.
