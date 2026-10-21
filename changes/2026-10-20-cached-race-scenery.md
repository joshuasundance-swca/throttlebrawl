---
kind: fixed
audience: player
---

A rematch on the same road now reuses its loaded water level and scenery models when
drawing the starting grid. This avoids two unnecessary road rebuilds during the
countdown. A newly selected road still loads its own scenery as it arrives.
