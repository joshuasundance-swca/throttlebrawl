---
kind: dev
audience: dev
---
Six new Blender models for the region build-out (the maintainer, 2026-10-01: "better visuals and experience"). For the Pacific Northwest: four conifers (two firs, a young fir and a cedar, 46 to 76 triangles each), a sawmill set piece with a teepee burner, and one timber trestle bent that repeats under the bridges. For San Francisco: four painted Victorian row houses (Italianate, Queen Anne, Stick and Edwardian), a cable car and two fog banks. Each is a script in `tools/blender/props/`, rebuilt byte-identically by `npm run asset:check`, scored by `tools/blender/models.test.ts`, and logged as AI-made in `THIRD_PARTY_ASSETS.md`. Flat colours only; the row houses' paints are separate roles so a region palette can repaint them. The game does not draw them yet: the render wiring follows in its own change.
