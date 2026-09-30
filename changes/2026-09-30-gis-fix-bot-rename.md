---
kind: fixed
audience: dev
---
Main went red when two PRs landed a minute apart: the real-road test (gis-1) still called the stub bot, which dev-1 renamed to `createBot` with a new `drive(snapshot, playerId, route, actions)` signature. The real-road test now uses the new bot; it still finishes the real route (about 185 s, all five roads crossed).
