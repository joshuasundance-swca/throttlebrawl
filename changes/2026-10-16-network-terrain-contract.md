---
kind: dev
audience: dev
---
Road networks can carry optional baked ground and water coverage as indexed triangles in their own world coordinates. The pack validator rejects invalid indices, non-finite Float32 coordinates, collapsed or downward faces, and sloping water after Float32 rounding. The road handle retains the registry's readonly authored data; omitted coverage adds no surface. Existing content hashes cover the geometry while leaving network provenance out of the simulation hash. This is the data contract for the regional-ground prototype; physical queries and drawing are integrated with its consumers.
