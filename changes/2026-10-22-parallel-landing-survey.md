---
kind: dev
audience: dev
---

The existing landing survey now divides its routes across three ordinary test files in the same
CI job, allowing its races to use the job's existing workers. Its three-event cohort, seeds,
player policies, race rules and pooled landing thresholds stay the same; Iowa remains outside
this survey. A mandatory reporter checks the complete shared inventory and pooled results, so
missing, filtered, skipped or failed cases cannot pass as a partial survey. This replaces the
old aggregate test rather than adding another CI acceptance path.

The three file weights are provisional planning reservations mapped from every completed race
in accepted train 39817621785, with printed-duration rounding and the source file's import
residual included. They are not measured new-file durations or a speed guarantee. Other timing
entries, workers, slice counts, timeout headroom and performance limits are unchanged; actual
parallel timings still need CI measurement.
