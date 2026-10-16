---
kind: dev
audience: dev
---
Browser CI planning now refines its greedy file assignment with a bounded, deterministic search
over relocations and swaps, using the same worker, file-order, parallel-spec, setup and perf
estimates. The two split UI specs use mean reservations from two accepted complete-case runs;
every other timing stays unchanged. This improves the predicted balance without changing test
coverage, slice counts, deadlines or the planning line. It does not guarantee CI running time.
