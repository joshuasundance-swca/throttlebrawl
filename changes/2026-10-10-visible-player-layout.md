---
kind: fixed
audience: dev
---

Player/HUD layout checks now use the actual renderer's depth-visible player fragments, with the
film pass's bounded outline reach. During a tumble, body vertices below the road can project into
a prompt while the road hides them completely; the previous per-bone boxes counted that hidden
geometry as visible overlap. The original riding hull and posed geometry remain separate
calibration controls.

The test-only mask keeps real skinning, instancing, alpha, culling, depth and entity identity.
Ordinary sampling runs only for consumed layout frames and rejects missing or empty player masks.
It compares individual painted spans, preserving empty space between detached bodies. A controlled
opaque object hides a previously visible primary-raster patch in one actual frame; a plate there
stays clear, while a plate over the remaining visible player is detected.
Existing overlap, detached-body, rival identity and 90-consecutive-visible-line checks remain.
No camera, HUD behavior, budget, allowance or test deadline changed.
