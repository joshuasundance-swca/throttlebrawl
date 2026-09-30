---
kind: dev
audience: dev
---
The sim world keeps the previous tick's events readable during the next tick (`world.lastEvents`), so combat can credit a takedown from a crash into traffic that happens later in the tick than combat runs. Nothing a player sees changes yet.
