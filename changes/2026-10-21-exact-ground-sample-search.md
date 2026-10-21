---
kind: dev
audience: dev
---

Ground queries reuse bounded nearby-sample indexes instead of scanning the same road samples for every moving point. Exact sample distances, tie order, overlapping-road candidates, projection and height selection are preserved. This reduces the added cost of keeping pedestrians on connected ground; support checks and test deadlines remain unchanged.
