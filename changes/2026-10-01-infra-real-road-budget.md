---
kind: dev
audience: dev
---
The perf check's whole-build limit goes from 5 MB to 6 MB (`tests/perf/budget.json`, `firstLoadKB` 5120 to 6144), for the real roads that land as routes in the Pacific Northwest and San Francisco packs (the maintainer, 2026-10-01: "Yes, add as routes"). Their road data is 23 JSON files, 0.88 MB in `dist/` (about 0.43 MB gzip), and the game fetches a region's road data only when a race there starts, so what a phone downloads before the first screen does not grow. The check counts every file in `dist/`: main measured 2.43 MB on the dev machine, the real roads bring it to about 3.3 MB, and the spoken-bark clips (about 1.9 MB) to about 5.2 MB, over the 5 MB limit; 6 MB leaves about 0.8 MB. Cheaper road bytes are a follow-up: minified JSON in the build, or the reserved `f32-columns` binary encoding. The JavaScript limit (500 KB gzip) and architecture's 15 MB first-play ceiling are unchanged.
