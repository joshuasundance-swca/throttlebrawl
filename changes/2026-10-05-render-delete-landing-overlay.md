---
kind: changed
audience: player
---
Nothing changes on screen: the landing one-liner ("TEN OUT OF TEN, SAYS A PELICAN") already shows on the top strip, and this removes the old drawing of it under the bike that the strip replaced. The chalk landing mark and the newspaper are untouched.

For devs: deleted the landing-line overlay from `src/render/air-pays.ts` (the plate, its layout and texture, `bikeScreenBox`, `BIKE_SHAPE`, the screen-space scene and the `data-landing-line` canvas mark) and its callers: `render/index.ts` (the overlay draw and `hideContent`'s hide), `EntityViews.riderFrame` (only the overlay used it), `contentLines` and the `line` kind of `VisibleContent` in `render/boards.ts`, `withoutLandingLines` in `app/ticker-feed.ts` (render gets the catalog as built; it never reads the landing pool), and ui's career-prompt rule that hid the prompt while the overlay showed. `air-pays.ts` stays for the chalk mark and the newspaper. `air-pays.test.ts` now asserts that a surge landing, the player's or a rival's, leaves only the mark and the paper to draw. The layout check's landing-line frames measure the strip and are not changed. `docs/architecture.md` (the surge, the picking bullet) and `docs/content-packs.md` (`landingLines`) are updated. Not phone-verified; no browser was run locally.
