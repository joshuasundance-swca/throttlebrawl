---
kind: new
audience: dev
---
Four npm scripts for the Blender model pipeline in `tools/blender/` (its README has the details). `npm run asset:build` builds the models with headless Blender. `asset:check` proves each committed GLB rebuilds byte for byte. `asset:render` draws three views of each model and a contact sheet. `asset:score` checks the committed GLBs against their budgets. The first three read `BLENDER_EXE` and skip with a note when Blender is absent, as on CI; `asset:score` needs only Node.
