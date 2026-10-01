---
kind: changed
audience: dev
---
The check that no region's cop waits in a travel lane (`tests/sim/cops-parking.test.ts`) now also runs each event on its region's real-road routes (`realRoutes`, `RaceSetup.route`). Today that adds the Keys' Bahia Honda run, whose lot holds. A real-road route that lands without a `copSpawn` near its start fails it, because the cop would wait in the drive lane behind the grid; the fix is a `copSpawn` in that route's GIS config.
