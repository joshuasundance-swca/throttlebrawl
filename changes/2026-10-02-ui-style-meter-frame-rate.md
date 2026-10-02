---
kind: dev
audience: dev
---
The oncoming-meter browser test judges the meter in the stretch's own seconds instead of counting frames: the meter must be up from 0.5 s and stay up until the stretch pays, each within one drawn frame, and the chip must land on the exact award. A slow CI runner draws fewer frames, and a rival who cut the stretch short at 2.1 s left 30 frames, one short of the old floor, so main failed. The test also stops requiring the meter's last frame to show the exact award, because a stretch can end between two drawn frames; the landed chip still must.
