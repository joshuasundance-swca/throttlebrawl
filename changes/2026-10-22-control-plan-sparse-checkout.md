---
kind: fixed
audience: dev
---

The train's diagnostic planner now checks out the simulation helper imported by its shared
shard planner. A regression runs the real planner from the declared sparse directories and verifies that unavailable
observations still emit the full diagnostic fallback. Job selection and acceptance rules are
unchanged.

Performance reports also record the final sampled simulation tick and retained audio-call counts
at tap completion and the final sample, helping investigate slow runs without changing the timing
probe, budgets or guards.
