---
kind: fixed
audience: dev
---

The still-scene cost sweep now checks the forward takedown camera from chase, far chase and helmet views, with its bounded lateral victim bias. The historical all-around camera envelope and Bridge City side-street and heavy-block controls remain as extra safety checks, calibrated independently of current camera defaults. Draw-call limits, triangle limits, sampling intervals and the historical pose tolerance remain unchanged.

The elevated takedown uses at most the normal top-speed chase field of view, preserving calmer settings and the ordinary helmet lens. This avoids combining the distant elevated eye with the helmet's widest lens, which the corrected sweep exposed as over budget. The ordinary helmet cost view also includes its forward eye offset.

The Seven Mile GIS fixture now checks occasional branch participation instead of the superseded highway-only rule. Its geometry, jump capability, splash respawn and race-progress checks remain. Explicitly barred branches are still covered by the separate sim tests.
