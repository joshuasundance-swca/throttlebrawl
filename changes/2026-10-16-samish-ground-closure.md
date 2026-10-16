---
kind: fixed
audience: player
---

Lake Samish's new highway access roads no longer leave open terrain edges beside elevated crossings.
The retaining faces close to each crossing while keeping enough height for the traffic allowed below.
Sharp changes in roadside land width also close the exposed side of their terrain slope instead of leaving a view underneath it.
Terrain slopes and their adjoining flat ground now use fewer triangles while keeping their shared edges closed.
Those adjoining pieces now reuse one terrain profile, avoiding repeated geometry work without changing the drawn ground.

The scenery check now finds ground by the mesh's actual bounds after batching, replacing its assumption
that every mesh stays within one named chunk of a prop. It still checks every scenery anchor and the
same wide-prop footprint rings against the first drawn surface, with controls for water and missing land.
