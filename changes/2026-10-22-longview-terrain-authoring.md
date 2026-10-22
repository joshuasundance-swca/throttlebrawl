---
kind: dev
audience: dev
---
Street Diamond terrain retains source map polygons and coarse elevation observations with separate
approximate water levels, explicit bridge-deck ownership and generic frontage ground guides.
Preserved numeric inputs, capture records, precision qualifications and the selected physical
geometry identity travel with the offline recipe. Generic render-only land solids are omitted on
rideable terrain; physical frontage scenes remain. Civic Triangle needs its own geometry review.

The generated mesh is pinned in the existing dataset rather than committed to Git. Build, development
and filesystem pack checks share one verified-cache materializer; normal network JSON loading and
full production schema validation remain in place. It is emitted once with the network, with no
additional runtime terrain fetch or runtime asset row. Local setup uses
`npm run assets:fetch -- --build-inputs`; the generated pack index still describes authored sources.

The original mixed-junction cache regression remains an explicit no-terrain control. The shipped
course drawing check supplies the terrain builder and retains lane, recovery-margin and walking-area
checks. All original road-compiler provenance fields still compare in full; separately derived
network terrain has its own manifest and geometry identity. The apron regression checks actual
unsnapped interiors and boundaries against slab thickness, rather than exact guide-plane equality.
