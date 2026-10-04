---
kind: changed
audience: dev
---
The renderer now says what is in view, in words. `render.visibleContent()` returns every sign, billboard, incident cone and landing line on screen as `{ref, kind, label}`, once each, with the label being the item's words on one line. The pause screen's "recently seen" list was empty because nothing ever read what was on screen; the app's poll (every 30 frames in a race, in the ticker-integration task) now has something to read. Players see no change yet.

For devs: `Boards.visibleContent(camera)` and `contentLines(refs, catalog)` are in `src/render/boards.ts`; `visibleContentRefs()` stays and is built from the new call. The landing lines still come from the overlay (`air-pays.ts`, removed later), so their words are looked up in the board catalog. `scene-cost.test.ts` now rides every branch a route allows off its main path as well as the main path (same 80 draw-call and 110k triangle caps; the busiest view of any route, branches included, is 70 calls and 95k triangles, on San Francisco's hills run), so a real route added later, such as Duval or Seven Mile with its old bridge, is measured the moment its route file lands. Touched `docs/architecture.md` (the picking bullet). Not phone-verified.
