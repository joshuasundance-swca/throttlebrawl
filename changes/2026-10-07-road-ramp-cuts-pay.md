---
kind: fixed
audience: player
---
The two ramp-truck shortcuts now pay. Jumping the truck onto San Francisco's Plaza Cut or the Pacific Northwest's Mill Yard Cut used to save nothing: each ran beside the road it skipped and was just as long, so "FOUND IT" said 0 s. Now the avenue swings out round the headquarters' plaza, and the flats round the mill yard, in one long sweep, while the cut goes straight through. The Plaza Cut is about 32 m shorter and the Mill Yard Cut about 31 m. Flown well, either one puts you more than a second ahead of riding the road.

Flying it well means steering right off the lip and letting the stick go once you are over the cut. Hold the stick over all the way to the ground and you still land wobbling. Both trucks also have a longer, shallower deck now, so a fast bike that hits one flat out lands clean too. Off the old, steeper deck, anything over about 50 m/s came down too hard to land clean.

For devs:
- Why the live check (polish M, punch items 1 and 2) saw a gain of -0.5 m and -0.2 m: the route table's `gainM` (`createRouteProgress`, the split zone's distance to finish less the cut's) is the main stretch less the cut's own length. Both cuts ran parallel to a straight main road and eased back in to merge, so each was a little longer. `stampShortcuts` stamps `savedS` as `gainM` over the rider's speed on the cut, so it said 0.
- Why 5 of 5 landings wobbled: the live check's thumb held the stick right until touch-down. In `land()`, `touchdown()` judges the lean, and full lock asks for 0.7 rad against the 0.55 line (`LAND_LEAN_WOBBLE`). The downward speed (11.1 to 13.6 m/s) was under the 14 m/s line. In the sim harness the held flights also came down with no sideways speed on the Plaza Cut, because its soft edge held the bike. On the Mill Yard Cut at 30 to 34 m/s they came down sliding at 7.5 to 8.6 m/s sideways. Let go of the stick before the ground and the same flight lands clean. But off the 13.7° deck, a lip faster than about 50 m/s lands at 14 m/s or more on level road however it is flown, and the long route's bike reaches 51 m/s at the Mill Yard truck.
- Moved, all `[default]`:
  - `tools/road/tracks/sf-downtown.ts` and `pnw-c1.ts`: the main road's control points past the split. A sin² bow 80 m to the left over 450 m, sampled every 28 m, then 60 m straight before the merge. The tightest radius is 132 m in SF and 137 m in the PNW.
  - The avenue's yard piece is now 688 m (SF) and 677 m (PNW). The cut's middle road is 655 m and 645 m. The cut's via points are 150 m past the split and 100 m short of the merge, on the old line.
  - The Pacific Northwest's flats up to the split did not move. San Francisco's Campus Way moved by up to 0.49 m from its s 128.
  - The named branches are now `kind: 'shortcut'`.
  - The routes are longer: Downtown from 3634 m to 4122 m, and the Sawmill Haul from 6624 m to 7039 m. `pnw-c1.test.ts`'s bound for the long route is now 6800 to 7200 m.
  - Both trucks have `rampLengthM` 15 (10.6°, the same 2.8 m lip), the same lip s, and `s0`/`s1` 1.3 times as long (`carrier-dt-plaza-cut` is s 625 to 652.5 and `carrier-mill-cut` s 560 to 587.5). The Mill Yard wall starts at 560.
- `src/road/structures/downtown.ts` `planSfDowntown`: no San Francisco building stands across another road's lanes any more (`roadCuts`, Portland's rule, with the same 2.8 m clearance). With the bow, the towers behind the avenue's plaza stood on the cut, and a rider in its lane met their sides. Outside the moved ground, all 402 and 408 buildings of seeds 7 and 8 are unchanged (`downtown-main.test.ts`).
- `src/render/downtown-main.test.ts`: the moved ground (two boxes) and the moved edges' surfaces (edges 4 to 8) are left out of the comparison with main. The same is done for Portland's changed land.
- Tests:
  - `tests/sim/ramp-truck-cuts.test.ts`, new describe. It covers every ramp-truck shortcut it finds, on the race's own bike, and runs the race's stamp after the riders.
  - Each cut's route gain must be at least 20 m.
  - The clean thumb must take the cut, land clean with no wobble, and be stamped with a gain of at least 20 m and at least 0.5 s saved. Measured: 32.2 m and 31.1 m, 0.7 s each.
  - It must finish at least 0.5 s ahead of two controls, the main road with and without the jump. Measured: 1.5 to 1.9 s ahead on the Plaza Cut and 1.2 to 1.3 s on the Mill Yard Cut, at lips of 39.0 and 50.8 m/s.
  - The held thumb must wobble.
  - Before the move, the test failed on the route gain (-0.5 and -0.2).
  - `tools/road/truck-shortcuts.test.ts` also flies at 50 and 60 m/s and checks that each branch is a shortcut of at least 25 m.
- Not phone-verified, and no browser was run. The render tiers (road-clear, scenery, the downtowns) run in CI.
