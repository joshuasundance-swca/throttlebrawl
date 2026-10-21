---
kind: fixed
audience: dev
---
The independent pedestrian contact, threat and road-entry checks now read every tick of the existing shared Normal races instead of running those races again. The checks still cover seeds 1 through 5 and continue in order through at most seed 16 until both threats and road entries have been seen. Cached results retain the same ordered diagnostics and reject missing or malformed checker data.
