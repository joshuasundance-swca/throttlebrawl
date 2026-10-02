---
kind: dev
audience: dev
---
Contract for riding off the road, branching routes and U-turns (interview, 2026-10-02: "Anywhere with ground", "junction choices in races", "U-turns", marked dirt shortcuts). The sim gains `src/sim/ground.ts`: a `ground.offRoad` switch (off, so every race runs as before) that lets a rider's position run past the lanes to each verge band's outer edge, the edge kind that stops it there, the ground under the wheels, and a grip and a speed for every surface as tuning. Routes gain branches: every split onto allowed roads is one, picked by position at the split, and a route file can name it (`branches`: id, roads, shortcut, detour or alternate, marked or secret, a sign); a branch over dirt roads is a marked dirt shortcut. `RouteProgress` gives `branches`, `branchAt` and `orientation`, and the snapshot carries each rider's `ground`, `routeDir` (1 racing, -1 after a U-turn) and `branch`. The off-road, roads and riders lanes wire the behaviour next.
