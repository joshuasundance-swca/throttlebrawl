---
kind: dev
audience: dev
---
Main fix-forward: main's first-load JavaScript went to 500.2 KB gzip, over its 500 KB budget, when the career data (#339) landed after other merges. The packs' `meta.notes` (the why behind each entry's numbers, which the game never reads) now stay out of the bundled pack JSON: a build-only Vite plugin (`scripts/pack-notes.mjs`) drops them before Vite bundles the JSON. The files on disk, the pack check, the tests and the dev server keep them, the road data shipped as files is untouched, and no sim-facing field changes, so replay keys hold. The first load goes back to about 485 KB.
