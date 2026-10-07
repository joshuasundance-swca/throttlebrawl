---
kind: dev
audience: dev
---
The sim test slices get a 15-minute job limit, up from 10, and every slice is now planned to at most two thirds of its job's limit, down from 70%. The first train on eight sim slices ran one slice to 617 s against a plan of 408 s: the same test files run up to 1.5 times their measured time from one CI runner to the next, so a slice planned at 70% of 10 minutes could not fit. The limit is the guard against a hung test; the two-thirds line keeps the plan honest. It costs no extra job (the full gate stays at 21 jobs). Two stale mentions of seven sim slices are fixed.
