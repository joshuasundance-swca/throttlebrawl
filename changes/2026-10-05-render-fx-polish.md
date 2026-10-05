---
kind: fixed
audience: player
---
Three rough edges from the live check, fixed.

- **Tyre smoke is smoke.** A drift's smoke was a line of grey slabs behind the rear wheel that read as concrete blocks. It is now soft, round, see-through puffs that swell as they rise and fade to nothing.
- **A hit's sparks are fine sparks.** In the ink looks (Ink + 60s film, Sun-bleached wasteland, Kodachrome brush) a hit beside your bike burst into big flat yellow shapes over the lower left of the screen. The sparks are now small chips, finer the closer they are to the camera, never thrown back at it, and without the heavy black outline.
- **Street signs read in every look.** The green sign "THIS INTERSECTION IS IN BETA" (and every other board face) was inked into a smear in the three ink looks. The film pass now leaves a sign's lettering alone, so it reads as it does in Classic.

For devs: `src/render/skids.ts` (cloud texture, per-puff alpha attribute, view-facing shader patch; still 2 draw calls), `src/render/effects.ts` (spark size, near-lens scaling, no throw at the lens), `src/render/looks/{ink,index,post}.ts` (`NO_INK_KINDS` write alpha 0, the film pass skips the brightness ink there). The test is `src/render/fx-polish.test.ts`. `docs/architecture.md` is updated in two places. Not phone-verified, and no browser was run: the unit tests cover the rules (soft edge, translucency, fade, no spark at the lens, a spark's size on a 412 px view, the shader patch and the pass's gating), but the final pixels (that the smoke looks like smoke, that the sign text reads at distance in each look, that the sparks read) need the maintainer's eyes or the live check.
