---
kind: fixed
audience: player
---

Lake Samish's new highway access roads no longer leave open terrain edges beside elevated crossings.
The retaining faces close to each crossing while keeping enough height for the traffic allowed below.
At elevated crossings, sharp changes in roadside land width close the exposed side of the whole terrain profile instead of leaving a view underneath it. Width changes on open ground stay joined without an artificial cut.
Terrain slopes and their adjoining flat ground now use fewer triangles while keeping their shared edges closed.
Those adjoining pieces now reuse one terrain profile, avoiding repeated geometry work without changing the drawn ground.
Vehicle figures likewise share their common placement work without changing their scale, paint or pose.
The landing chalk and newspaper now load with the rest of the race effects instead of the opening menu.

Where a fern clump is left out over another road, its empty stretch no longer holds the rider against an invisible brush edge;
the neighboring clumps, hedges and fences still hold as before.

The Lake Samish rider approaches now meet the highway junctions without an accidental launch lip.
Their game elevations ease back to the sampled bare-earth profiles over authored 80 m and 120 m
approach spans. This adapts the two approach profiles and their three connecting profiles while
keeping the source paths, lane choices, roadside features and the junctions' shared surfaces.

The scenery check now finds ground by the mesh's actual bounds after batching, replacing its assumption
that every mesh stays within one named chunk of a prop. It still checks every scenery anchor and the
same wide-prop footprint rings against the first drawn surface, with controls for water and missing land.

The listed-barrier check now compares a moving rider's first contact with the panel at that contact
station, replacing its assumption that the rider stayed at the starting station for the whole step.
It keeps the same rays, body reach, approach angles, wall samples, truck-cut checks and handover checks.

At overlapping traffic connections, pavement now follows the actual drawn height of the receiving
lane or shoulder. A traffic strip above a lower shoulder remains visible, while near-coplanar
stacked surfaces are still removed. This keeps the northbound Samish connection supported.

Drawing and physical ground queries share the search for where a roadside band must stop over
another road, preserving visible shoulders while leaving clipped space open.
Physical ground also uses the same terrain spans and triangles as the drawing. Curved-road
projections keep the original world position, preventing a distant hillside from becoming an
invisible floor. Real drops and water remain hazards.
