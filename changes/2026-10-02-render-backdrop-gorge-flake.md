---
kind: dev
audience: dev
---
The backdrop browser test no longer fails at random on its second look. Each case races twice on one page (Ink + 60s film, then Classic), and the preview server sends the game's code chunks as `no-cache` with an ETag. So on the second load the browser sometimes checks the chunk it already holds, and the server answers 304 (Not Modified). The test counted only 200-range answers as "fetched", so it waited 30 s for a chunk that had already loaded, then failed. It now counts a 304 as fetched too. The check that no other region's backdrop loads also counts 304s now, so it is a little stricter. All 4 such failures in the last 60 failed CI runs were this one: pnw-gorge twice, pnw and sf once each, always on the Classic run and always at the fetch check. Nothing in the game changed.
