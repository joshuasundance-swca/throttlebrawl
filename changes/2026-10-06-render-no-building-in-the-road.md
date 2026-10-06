---
kind: fixed
audience: player
---
Bridge City no longer has buildings standing in the road. Where the Morrison shortcut leaves Broadway and where it comes back at the Hawthorne Bridge's east end, shop fronts and a pink tower stood on the lanes, and you rode straight through them (the maintainer's phone play, 2026-10-06: "in bridge city near shortcut(?) junctions in two places it seems like there's a building in the road"). The shortcut's short link roads carry the downtown blocks on both sides, and their fronts landed on the main road's link and on the bridge's end. A slab of the bridge's sidewalk paving also hung a metre over the shortcut's way back. Both places are clear now. The street looks the same: 472 buildings stand along Bridge City's roads, against 473 before.

For devs:

- **The fix.** `planPortland` in `src/render/downtown.ts` now checks every lot against `roadCuts`. That function files a cut across every road's lanes each metre, on every edge of the network: branches, connectors and a junction's other road. A footprint may cross no cut, from its lanes' edge out to `PDX_ROAD_CLEAR_M`. The old nine-point projection still runs as well. It only saw the building's own road and that road's neighbours.
  - The sidewalk, the lot floor and a cross street's asphalt now stop where they meet another road's lanes (`offLanes`). Bike racks and carts keep off those lanes too.
  - `groundOver` now samples the road every 2 m or closer, not 4 times. A new front on the shortcut's link stood 1 cm under its crest.
- **The CI check.** `src/render/road-clear.test-util.ts`, with `road-clear-keys`, `-sf` and `-pnw.test.ts` (one file per pack, so CI runs them side by side), covers every network: all 19 of them, seed 1, with Bridge City on seeds 2 and 3 as well.
  - It builds every still layer the renderer builds, using `stillSceneOf` from `scene-cost.test-util.ts`, which gains a `roots()` method for this.
  - It rides a camera along every edge, and fails if any drawn triangle cuts the space a rider rides through. That space is 0.5 to 2 m over every lane of every road, from 0.5 m inside the lanes' edge.
  - Two things are allowed by rule (`ALLOWED`, `[default]`): ramp trucks, and roadside shrubs and conifer boughs that lean at most 1.5 m and 1 m over the lanes' edge.
  - Known hits that are not buildings are listed, by network, part and road, in `KNOWN` (below). Every run prints them, and a new road or a deeper cut fails.
  - The negative control plants a building on Alder Street (the shortcut's own road) and finds it there, at s 197 to 203 over 30 cells. A building just past the lanes, and a board hung over them, are not found.
  - Before the fix, Bridge City failed on all three seeds (9 places at seed 1). After it, there are none.
  - `portland-blocks.test.ts`'s "no building stands on a road" check now tests every point of a 2 m grid over each footprint against every road (`EdgeLocator`), and fails on main's placement.
- **Hits the check found that are not buildings,** left as follow-ups (each is a `KNOWN` line):
  - verge fences, brush, hedges and a guardrail drawn across a split's or a join's other road: the Keys' M1 marina split, Lake Samish's leave and join, the C1 mill and spur splits, Lombard's ends and the SF hills park cut;
  - the Seven Mile's bridge bays and rails across the old road's split and join;
  - three billboards that stand on a branch's lanes: Sandbar Flats' on Tarpon Flats, and the SF hills' on the stair alley and the park cut;
  - Campus Yard's lamps, hydrants and a planter on the SF downtown Plaza Cut;
  - the stair alley's brick courses.
- **Draw calls.** The run B fix check saw one Bridge City frame draw 112 calls (seed 3, Broadway South s 234, tick 5472). The still scene at that spot is not where it grew: the same sweep finds the same counts on run B's code and today's (31 to 61 calls by camera there, 78 at the route's busiest view). The rest is what moves.

Not phone-verified. No local browser was run.
