---
kind: dev
audience: dev
---

The road renderer can now draw a network's authored terrain faces as its natural land and water. It keeps their heights, flat normals and holes, batches complete faces into spatial chunks, and leaves the existing road and bridge layers in place. Networks without authored terrain retain their existing ground.

Seeded roadside scatter uses the supplied surface height and drops candidates over uncovered space or the wrong surface. Boats bob above the authored water level. Procedural scenery source geometry and empty instance geometry are released when the scene closes.

This is a renderer prototype consumer, with no route activated. The continuous legacy land-strip interface deliberately returns no reach for authored terrain; staged vignettes and landmarks need their own coverage integration before activation.
