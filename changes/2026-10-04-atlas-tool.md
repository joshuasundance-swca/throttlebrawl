---
kind: dev
audience: dev
---
A new tool bakes each region's texture atlas: one 1024 x 1024 PNG-8 sheet per region, drawn by code in `tools/atlas/sheets/<region>.mjs` with integer-only primitives, so a bake is identical on every machine. `npm run atlas:build` writes the PNG and its layout file into the region's pack; `npm run atlas:check` rebakes in memory and compares the decoded pixels and palette with the committed files, and the unit tests run the same check, so CI catches an atlas that drifted from its sheet without Blender. The tool refuses invented words on an atlas: text can only be real landmark lettering listed in `tools/atlas/lettering.mjs`, so the in-game "cut this" veto keeps working on every sign and name. No region sheet exists yet; the Codex asset batches add them. The two npm scripts ride in this PR, since only this tool uses them.
