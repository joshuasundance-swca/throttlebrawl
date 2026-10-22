---
kind: fixed
audience: dev
---

The train's diagnostic planner now checks out the simulation helper imported by its shared
shard planner. A sparse-checkout regression runs the real planner and verifies that unavailable
observations still emit the full diagnostic fallback. Job selection and acceptance rules are
unchanged.
