---
kind: changed
audience: dev
---
The Keys' real-road data (the Bahia Honda run) is no longer in the first-load JavaScript: it is fetched in the background at boot, like a region's roads, and the route picker offers it once it is in. First-load JavaScript drops from 491.7 KB to 432.1 KB gzip (budget 500 KB). Races wait for it, so every replay key covers the same content as before. Tests that check the base pack as authored read the new `base-pack-whole.ts`.
