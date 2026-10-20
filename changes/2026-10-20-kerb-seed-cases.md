---
kind: dev
audience: dev
---
The San Francisco kerb live check now runs the ten enabled seeds as separate serial cases. Each case keeps the full race, tick cap, zero-crash assertion, and zero non-kerb-wobble assertion. A final check verifies that every derived seed key ran and that the combined races encountered light kerb riders.

The old disabled-slider races and their printed before counts were removed because they were diagnostics rather than assertions. The controlled negative tests in `src/sim/traffic/kerb-yield.test.ts` still pin the old crash behavior when yielding is disabled or the tuning keys are absent. Each live case receives one tenth of the former 300-second aggregate allowance; measured case times are printed, including any overrun.
