---
kind: dev
audience: dev
---
Contract PR for the riders lane: `SimEventType` gains `wobble`, the event a rider emits when it loses stability without going down (scraping the barrier, a rough landing, and later traffic-1's first contact). riders-1's barrier rule and riders-2's landing quality need it, because M1's acceptance asks for "a wobble or crash event". Nothing else changes.
