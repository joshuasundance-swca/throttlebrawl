---
kind: fixed
audience: dev
---
Two small wires for traffic. The sim snapshot now names each vehicle's traffic type in `contentId` (it was empty), so the renderer draws a box truck as a truck. The race HUD's "1st / N" now counts only the racers; it counted every entity, so with traffic on it read "1st / 16" in a two-rider race.
