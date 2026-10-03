---
kind: dev
audience: dev
---
Two infra follow-ups.

`npm run assets:upload` now compares files by content, not by path. Before, it uploaded only the pinned files whose path the dataset lacked, so a changed model at an existing path was never uploaded and the lock would pin bytes the dataset did not hold (found while recovering #346). It now asks the Hub's paths-info API what the pinned revision holds: an LFS file's sha256, or a plain-git file's git blob id, which it computes from the cached bytes. A file that is new or holds other bytes goes up; after the upload it checks the new commit the same way before pinning it. Checked against the live dataset: all 17 pinned files came out the same, and a file changed at its existing path (marker-cube.glb) came out "changed". Unit tests cover the git blob id, a changed file of the same length, a new file, LFS files, files it cannot upload, and the batched paths-info call.

The CI slice timings (`tests/timings.json`) are re-measured from the three green main runs since the whole-race browser specs moved to lockstep (#370): 37089464176, 37089803510 and 37091225432 (59 sim files, 47 browser specs, perf 94.5 s). ui-route-picker went from 400 s to 48 s and ui-screens from 207 s to 76 s, so the old plan had become lopsided: in run 37091225432 the browser slices took 118, 333, 337 and 652 s. The old plan, timed with the new numbers, predicts 69 to 580 s per browser slice; the new plan predicts 345 s each, and 223 to 225 s per sim slice (from 182 to 274 s). The browser table is measured again too (the previous refresh kept it from older runs because ui-route-picker's real-time race timed out next to busy specs; it now fast-forwards). Every file still runs in exactly one slice.
