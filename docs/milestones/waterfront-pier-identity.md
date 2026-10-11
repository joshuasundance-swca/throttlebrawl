# Waterfront pier identity

[default] Make the existing numbered piers clearer from the chase camera with ivory lettering on dark teal, using the existing box font and merged geometry.

## Automated acceptance

- For actual seeded frontages, use existing dark-teal `pierText` backing and ivory `shedTrim` letters inside the unchanged raised-middle bounds.
- Backing: width 12 m, y 10.45–12.95, front z 0.08. Number: pixel size 0.46, center x 2.1, bottom y 10.55, front z 0.14. PIER: pixel size 0.25, center x −2.1, bottom y 11.075, front z 0.14. All letters fit the backing and clear cornice and pilasters.
- Read actual widths from plans; do not assert a whole-game count. Preserve source-derived numbering and all golden placement, geometry and collision controls.
- Height predicate rejects the old 2.1 m number height; coverage predicate rejects no backing; depth predicate rejects behind-wall letters; fit predicate rejects escaped letters.
- Replace the old phrase rather than add it. Add no materials, models, downloads or culling/LOD reach. The panel adds only two triangles per detailed shed.
- Run only `src/render/waterfront.test.ts` with the unit project and at most two workers; confirm RED for the intended missing sign before production and GREEN afterward.

## Served acceptance

The coordinator inspects rendered Waterfront from the normal chase view in the run's single served browser slot. Geometry acceptance alone is not a legibility verdict. Phone verification remains with the maintainer.
