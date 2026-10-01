---
kind: dev
audience: dev
---
The renderer's stats (`RendererStats`, which reach the test handle and the debug report) may now list the set pieces the road scene draws for the race's seed (`setPieces`: id, kind, seeded slot and position). It is optional. The render lane fills it next, so a browser test can check that two seeds draw the ramp truck and the boost pads in different places (playtest 1c item 2).
