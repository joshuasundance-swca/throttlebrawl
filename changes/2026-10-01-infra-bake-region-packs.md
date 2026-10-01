---
kind: dev
audience: dev
---
The road baker (`node tools/road/bake.mjs`) now finds every track source in `tools/road/tracks/` by itself and bakes it into the pack the module names with an optional `export const PACK = '<pack id>'` (default `base`), under `packs/<pack>/regions/<region>/`. A region pack's track (the San Francisco and Pacific Northwest regions of playtest 1c) needs no edit to the baker. Nothing changes for keys-m1: `--check` still reads its 18 files as fresh.
