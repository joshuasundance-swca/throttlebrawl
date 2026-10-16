---
kind: dev
audience: dev
---

The road renderer can now draw a network's authored terrain faces as its natural land and water. It keeps their heights, flat normals and holes, batches complete faces into spatial chunks, and leaves the existing road and bridge layers in place. Networks without authored terrain retain their existing ground.

Seeded roadside scatter uses the supplied surface height and drops candidates over uncovered space or the wrong surface. Boats bob above the authored water level. Procedural scenery source geometry and empty instance geometry are released when the scene closes.

Eagle Point now uses this terrain and an OSM-derived Mississippi river surface. The road collar blends into coarse USGS land below the pavement; the river height is a DEM proxy, not a current river stage. Grass stays recoverable where actual land continues, with real water and uncovered edges still hazardous. No blanket rails are added.

The riding prototype follows supplied land above or below its reference road, uses its slope for grip and landing pitch, and preserves travel in world metres around tight bends and across connected road ends. A continuous road-to-grass join does not create a false jump; leaving supplied land resets without first snapping to the road plane. Water exits use the supplied water height. A rail meets a grounded rider on the side approached, without pulling a rider across the field.

Grounded rider models follow the supplied face slope while the rig adds its wheelie once. Shadows and touchdown marks fit the same land, shrinking or disappearing at unsupported edges. The mark footprint uses bounded samples, so this is not a guarantee against arbitrarily small holes. Crash particles now meet the actual land faces, and their mover reference keeps their off-road position and height. Source water and dry holes remain distinct.

The offline recipe preserves numeric sources, credits, extraction hashes and the selected geometry fingerprint. It refuses changed inputs or divergent output. Secondary scenery cohorts still need their own support integration before opting in on another network. Flight forecasts and riding-only queries load with the existing race-step chunk to preserve startup size headroom.
