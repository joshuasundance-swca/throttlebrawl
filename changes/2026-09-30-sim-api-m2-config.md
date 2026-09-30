---
kind: dev
audience: dev
---
Sim contract for M2: a race's config gains per-player-slot assists (`slots[i].assists`: steering assist off, light or strong, and auto-throttle) and the lower-overall-speed multiplier (`speedMultiplier`, between 0 and 1). Both are optional in the type so every existing test config still means "no assists, full speed", and sim code reads them only through two `sim/world` helpers that fill in those defaults and keep a bad number out of the physics. The slow-motion toggle (`slowMo`) was already there. The old single `assists` field stays, unread, until the lanes' test configs stop setting it. Nothing reads the new fields yet; riders-4 and combat-4 do.
