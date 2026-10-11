---
kind: fixed
audience: dev
---

Menu layout checks now measure only the parts of transient cards that a scrolling detail pane actually paints. Full-card visibility and deliberately obstructing cards remain separate checks, including the old card-over-title failures.

The lazy-road browser check measures background loading from Home, then opens Quick Play before selecting its road. Region and race-setting checks also reopen Quick Play before choosing a region after returning to Home.
