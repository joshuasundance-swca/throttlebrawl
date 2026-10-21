---
kind: dev
audience: dev
---

The exact shoulder sampler now loads with the existing race-world planners or simulation steps. Its drawing constants and a small synchronous query seam remain available to the first screen. Early menu queries add no shoulder support until loading finishes; the existing awaited simulation-step loader installs the sampler before a race can tick. Prepared race creation warms its cached network plans before snapshots and the countdown. Repeated loading cannot replace its implementation.

Loading-boundary checks cover planner loading, an already-cached structure plan, and the public simulation-step loader by itself. The rendered shoulder, exposed empty-wedge, racing recovery and replay controls remain in place.

Existing AI combat helpers and cop driving routines also move unchanged into the awaited race-step chunk, preserving first-load headroom. Initialization remains available before race loading. A simulation created before preparation can still build its shoulder plan on the first later query; a retained-world comparison checks that this and prepared creation produce equal outcomes.
