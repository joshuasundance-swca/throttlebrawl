---
kind: dev
audience: dev
---

Transient-card browser checks now register the normal text size separately from large and
largest, so the existing browser workers can schedule their complete page cases separately.
Every callback, assertion and negative control stays intact.

The complete browser timing cohort now comes from accepted train run 39817621785, including
its browser setup time and perf reservation. The two split files map to 156 and 228 seconds
from their unchanged cases' rounded reporter observations. These are planning estimates,
not measured new-file durations or a speedup claim. Unit and sim weights and setup estimates
stay as they were; a complete current refresh still exposes their larger scheduling problems.

The timing refresh also retains a real positive mean when rounding to tenths would erase it,
including the observed 0.02- and 0.03-second sim files. True zero measurements and ordinary
tenth-second rounding stay unchanged; no timing floor is invented.
