---
kind: dev
audience: dev
---
render: a second, switchable look (playtest 1b item 6), not yet offered in Settings. The new `src/render/looks/` module wraps the classic look and hands out the same materials in every look, so `GameRenderer.setLook('kodak')` restyles the running game at once: ink outlines from a depth and brightness edge pass, hatching in the shadow bands drawn in world space (it stays put on surfaces as the camera moves), inked waves on the sea, a warm peach sky, and one final pass with a baked 16-cube Kodachrome grade, a warm vignette and film grain. `classic` stays the default and draws exactly as before (the unit tests check every material kind and the unpatched shader). Seven new `render.*` tuning sliders (outlines, outline width, hatch density, inked waves, grade, vignette, grain) change the ink look only. `renderer.info` now counts the whole frame, since the ink look draws twice. The settings row, its wiring and the browser checks follow in the next PR.
