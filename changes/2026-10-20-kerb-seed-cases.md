---
kind: dev
audience: dev
---
The San Francisco kerb live check now runs the ten enabled seeds as separate serial cases. Each case keeps the full race, tick cap, zero-crash assertion, and zero non-kerb-wobble assertion. A final check verifies that every derived seed key ran and that the combined races encountered light kerb riders.

The old disabled-slider races and their printed before counts were removed because they were diagnostics rather than assertions. The controlled negative tests in `src/sim/traffic/kerb-yield.test.ts` still pin light-rider crashes when soft contact is disabled or the tuning keys are absent, with separate yield-off cart coverage. Each live case receives one tenth of the former 300-second aggregate allowance; measured case times are printed, including any overrun.

The unused `softWobbles` diagnostic tally was removed while retaining the asserted crash and non-kerb-wobble counts; this is a test-only diagnostic simplification.
