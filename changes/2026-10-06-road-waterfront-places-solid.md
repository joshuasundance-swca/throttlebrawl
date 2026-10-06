---
kind: dev
audience: dev
---
The waterfront's buildings and the Pacific Northwest's ferry and festival shops are now planned by the road, as the physical world's solid structures (the maintainer, 2026-10-06: "consistent physics and gameplay is important here so players know what to expect and how to interact with the world"; he accepted a road race in a physical world with honest edges: "Yeah that sounds good :)"). Nothing in the game changes: render draws the same buildings, and the sim does not read the new plans yet (the next lane does).

What moved, with its rules unchanged (the same seeded hash, spacing, widths, heights and keep-clear rules, with core's `sin`, `cos` and `atan2` for `Math`'s):
- `src/road/structures/waterfront.ts`: San Francisco's pier sheds and their decks, the ferry hall (with its clock tower tier by tier, and the ferry at its slip), the front, plaza, lot and side-street blocks, and the towers behind. Each building is a layout entry (kind, width, seeded `u`) with its solids: footprint, base and roof as drawn.
- `src/road/structures/pnw-places.ts`: the car ferry (bulwarks, the posts holding the passenger deck up, the deck and cabin over the road, funnel, wheelhouses), the Stump Social's false-front shops, each side street's barricade and tents, and the banners.
- `src/road/ferry.ts`: the ferry's numbers, moved out of render so the plan and the rain's roof agree.
- Render draws the layouts (`src/render/waterfront.ts`, `pnw-places.ts`): it builds each building's boxes and draws them where the plan stands them; the seawall, the side streets' roadways, the lot's lines, the city floor, the sea lions, the boats and the clear-cut's dressing stay render's (scenery, past the course).
- `STRUCTURE_LAYERS` gains `sf-waterfront` and `pnw-places`; each planner is a lazy chunk (`loadWaterfrontLayout` and `loadPnwPlacesLayout` in `src/road/index.ts` are render's doors to it), kept out of the sim chunk by `scripts/sim-chunk.mjs`. The sim chunk's dynamic import names the planner's content-hashed file, so a planner change still moves `simCodeHash`.

What is solid and what is not: bodies, roofs, decks, tower tiers, and a thing a rider could meet on a roof (the crab house's sign board and post, a water tank on its stilt). Trim and what hangs overhead (cornices, pilasters, awnings, blade signs, eaves, the fish, the flag, the bunting) is not; `scripts/hitboxes-waterfront-pnw.test.ts` bounds how far it reaches past the solids. The hull, aprons and piles under the road and the piers' piles are under the course. Boats, floats and the clear-cut stand outside it.

The one input that depended on the drawn scene: a side street's reach inland was the drawn land's (`landReach`). The plan uses the road scene's 24 m land strip, which is what the scene draws at every gap of the baked track at seeds 7 and 8 (a test holds it), so the picture is the same.

Held by tests (each written first, each with a control):
- `src/render/waterfront.test.ts` and `pnw-places.test.ts` hold the drawing to what main drew before the port (golden data from origin/main 00d41c9f): 579 moved waterfront items at seeds 7 and 8 and 252 places props on pnw-c1, positions and geometry bounds within a centimetre, turns within a milliradian; a block moved a metre or a tower a metre taller is found. The plan is the same before and after any model loads, and the road files' tags and features equal the network's.
- `scripts/hitboxes-waterfront-pnw.test.ts` holds every drawn solid to the plan's: 563 waterfront solids in 290 buildings and 285 places solids in 96 parts, worst gap under a millimetre; a solid moved, resized, raised, lowered or left out is found. What is drawn past the solids is bounded per kind.
- `src/road/structures/*.test.ts` plan the real tracks: the layers are asked for by the right tags only, plans are kept per seed, heights are as drawn (facade 10 m, its raised middle 13, the hall tower 70.5, the passenger deck 6.6 m over the road), no solid stands on a road's lanes (control: one planted there is found).
- `scripts/sim-chunk.test.ts` and `first-load.test.ts` hold the planners out of the first load and in the sim code hash.

Budgets: first-load JavaScript 461.0 KB gzip (39.0 KB under the 500 KB budget); the two planners are 3.5 KB and 2.2 KB gzip in lazy chunks. The drawn geometry is the same (the golden tests above), and the scene-cost tests for both regions pass. Not phone-verified (no visible change).
