---
kind: dev
audience: dev
---
Sim contract: `EntitySnapshot` gains an optional `parkedBike` (world position and heading, or null), for the bike a rider runs back to after a crash. tumble-1 parks the bike, but the snapshot carried one entity per rider, so render could not draw it and the player saw a rider running toward nothing. Optional, so hand-built test snapshots stay valid; the follow-up wire fills it for every rider and render draws it. Additive; no reader changes.
