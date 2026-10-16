---
kind: dev
audience: dev
---

The road renderer can now draw a network's authored terrain faces as its natural land and water. It keeps their heights, flat normals and holes, batches complete faces into spatial chunks, and leaves the existing road and bridge layers in place. Networks without authored terrain retain their existing ground.

Seeded roadside scatter uses the supplied surface height and drops candidates over uncovered space or the wrong surface. Boats bob above the authored water level. Procedural scenery source geometry and empty instance geometry are released when the scene closes.

This is a renderer prototype consumer, with no route activated. The continuous legacy land-strip interface deliberately returns no reach for authored terrain; staged vignettes and landmarks need their own coverage integration before activation.

The riding prototype follows supplied land above or below its reference road, uses its slope for grip and landing pitch, and preserves travel in world metres around tight bends and across connected road ends. A continuous road-to-grass join does not create a false jump; leaving supplied land resets without first snapping to the road plane. Water exits use the supplied water height. A rail meets a grounded rider on the side approached, without pulling a rider across the field.

Grounded rider models follow the supplied face slope while the rig adds its wheelie once. Shadows and touchdown marks fit the same land, shrinking or disappearing at unsupported edges. The mark footprint uses bounded samples, so this is not a guarantee against arbitrarily small holes. Crash bodies, airborne barrier crossings and secondary scenery still need integration before route activation.
