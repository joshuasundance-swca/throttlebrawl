---
kind: dev
audience: dev
---
The perf check's whole-build limit goes from 3 MB to 5 MB (`tests/perf/budget.json`, `firstLoadKB` 3072 to 5120), for the spoken barks that land next: 247 Opus clips, about 1.9 MB, baked into the pack. The check counts every file in `dist/`, lazy ones included, and the clips are fetched only the first time each line is said, so what a phone downloads before the first screen does not grow. With the clips the build measured 4.47 MB on the dev machine (2.54 MB without them), which leaves about 0.6 MB for the region build-out's other assets. The JavaScript limit (500 KB gzip) is unchanged; the clips' URL table is a lazy chunk. Architecture's 15 MB first-play ceiling for the phone still stands.
