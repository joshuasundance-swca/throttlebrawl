---
kind: dev
audience: dev
---
Main fix-forward: the forgiving-landings batch (tests/sim/riders-landings.test.ts) runs with the W-P road events off, like the other batches that measure one system (`NO_ROAD_EVENTS` from tests/sim/batch.ts). With them on, seeds 1 and 2 reshuffled so the bot was hit by traffic 1 s after a clean landing, which the test counts as a bad landing; with them off it is 18 of 18 clean, as the riders lane measured. The ui-screens race test also gets a fixed seed whose bot race ends quickly (110, about 85 s of sim): a fresh random seed could run to 140 s, which no longer fit CI's 200 s wait for the results in its software renderer.
