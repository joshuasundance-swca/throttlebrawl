---
kind: fixed
audience: dev
---
Contract fix in `src/sim/api.ts`: `quantizeInput` now always returns canonical integers, never `-0` and never `NaN`. `Math.round` turns a small negative steer (about -0.003) into `-0`; the sim hashes the exact bits, and JSON writes `-0` as `0`, so a race recorded live and replayed from its file (the debug file) desynced at the next checkpoint. replay-1 found this while replaying real bot races from the run-length-encoded file. A NaN axis from a bad device now reads as 0 instead of reaching the sim. The ranges are unchanged.
