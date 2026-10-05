---
kind: dev
audience: dev
---
Three small CI clean-ups after the 16-job layout (#486), none of which changes the game:
- The Pacific Northwest roadblock sim test (a cop chasing from out of sight is radioed ahead) no longer relies on a 300-second wall-clock timeout. Its seed search now spends a budget of sim ticks (5,000 a race, 40,000 in all, about half of the sim project's 90 s limit on CI), and it starts from faster-building heat so a race reaches the roadblock sooner. With the radio rule switched off it fails with "none of seeds 1 to 8 qualifies".
- The held-landings test has a guard: every air command in the check's `PATTERNS` must be run by one of the `riders-landings-held*.test.ts` files, so a new command cannot sit untested.
- A docs example in `docs/engineering.md` said the browser tier has 6 slices; it has 7.
