---
kind: dev
audience: dev
---
Main fix-forward: the forgiving-landings batch (tests/sim/riders-landings.test.ts) runs with the W-P road events off, like the other batches that measure one system (`NO_ROAD_EVENTS` from tests/sim/batch.ts). With them on, seeds 1 and 2 reshuffled so the bot was hit by traffic 1 s after a clean landing, which the test counts as a bad landing; with them off it is 18 of 18 clean, as the riders lane measured.
