---
kind: dev
audience: dev
---
Road networks can carry optional baked ground and water coverage as indexed triangles in their own world coordinates. The pack validator rejects invalid indices, non-finite Float32 coordinates, collapsed or downward faces, and sloping water after Float32 rounding. The road handle retains the registry's readonly authored data; omitted coverage adds no surface. Existing content hashes cover the geometry while leaving network provenance out of the simulation hash.

The query and drawing helper use the same Float32 faces, heights and flat normals. Queries retain holes, select the highest permitted surface and use stable authored order on ties; directly constructed collapsed faces fail explicitly. Application loading preserves the frozen physical source. Eagle Point is the first consumer, shipped with scene, riding and crash support in the same feature.
