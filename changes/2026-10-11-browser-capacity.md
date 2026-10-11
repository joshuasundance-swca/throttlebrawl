---
kind: dev
audience: dev
---

The full CI suite now plans ten browser slices. The refreshed timing table predicts browser maxima of 427 seconds for eight slices, 407 for nine and 367 for ten against the unchanged 400-second line. The pending Pivot coverage brings the inventory to 64 browser specs; that model probe predicts maxima of 435 seconds for eight slices, 403 for nine and 363 for ten; these are predictions, not measured job times. The full suite therefore has 22 jobs and may queue about two jobs against the approximate 20-job runner capacity. The unit and sim matrices, timeouts, `JOB_SHARE`, quick check, and gate permissions are unchanged. The last browser slice still runs perf and preserves the deploy artifact.

These predictions establish planning headroom only. This change does not claim faster wall-clock completion or lower cost; neither was measured.
