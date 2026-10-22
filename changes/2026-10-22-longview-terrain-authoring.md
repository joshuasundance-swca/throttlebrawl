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
The existing dataset Vite plugin owns preparation and assembly, including its Node self-test runner
callers; no second plugin registration is required.

The original mixed-junction cache regression remains an explicit no-terrain control. The shipped
course drawing check supplies the terrain builder and retains lane, recovery-margin and walking-area
checks. All original road-compiler provenance fields still compare in full; separately derived
network terrain has its own manifest and geometry identity. The apron regression checks actual
unsnapped interiors and boundaries against slab thickness, rather than exact guide-plane equality.

Scene fixtures draw the actual authored terrain instead of omitting its drawing dependency. Pack
emission checks compare complete schema output with materialized source inputs; independent runtime
asset checks still verify every pinned runtime file. Removing an apron now checks source-ground
fallback alongside the original missing-apron control on a cloned network without terrain.

Pedestrian geometry checks use the supporting floor that supplies their rendered feet, retaining the
same height tolerance. A connected market-side movement and missing-ground, water, mismatched-source,
upper-deck and legacy-ground controls cover that change. Regeneration input hashes identify the
canonical checked-in bytes; formatting did not change any of the preserved numeric observations.

Site riding checks enter from the drawn road and hold a fixed world heading on an off-road solid
approach, matching terrain steering. The boost must remain grounded across its own area and activate
while riding; the approach may briefly leave the real bank and land cleanly. This replaces the old
guarantee of no airtime anywhere along that fast grass approach, while preserving safe rejoin,
optional pickup, visible-solid contact and crash checks.
