---
kind: fixed
audience: player
---
The old Seven Mile Bridge is now easy to get onto (playtest 4, the maintainer: "too hard to get on... as long as it's reasonably and fairly truly accessible then the current respawn is fine").

- **The turn-off counts sooner.** You take it anywhere on the shoulder and the outer edge of the right lane, over the last 80 m before the split. Before, it was 40 m long and only counted with the bike pressed against the rail. Riding the middle of the right lane still keeps you on the highway.
- **The run-up to the ramp truck is nearly straight.** It turns 9 degrees on a bend of 230 m or more, which every bike holds at its top speed. Before, it turned 20 degrees on a 60 m bend that no bike held at the speed riders arrive, so a fast bike ran wide into the water.
- **Both ramp trucks are as wide as their platforms.** Before, each was 3 m wide on a 6 m deck, and a rider at either side went past it into the water.
- **The paint shows the way.** The turn-off's colour and chevrons are only painted on the road now; before, most of the paint and every chevron lay over the water past the rail. Chevrons also mark the 90 m before the turn-off, where a rider at the edge is already carried along to it. This applies to every shortcut whose zone runs out to the road's edge.
- **Every miss wakes you on the highway.** Falling at either truck hop now wakes you on the highway, as falling at the Moser gap already did. Before, a fall at a truck hop woke you past the gap, on the old road.
- The dev bot now takes the old road in its Seven Mile races too, as it takes the other shortcuts. Rivals and cops still keep to the highway (#489).

What was measured (one rider alone on the real road, at each bike's top speed, for the seven bikes at least as fast as the Rustbucket; steering assist off):

- At the turn-off the rider starts at three places across the zone: its inner edge, its middle and against the rail. After the split it either lets go or keeps to the centreline.
  - Before: 9 of 42 runs reached the old bridge. Every let-go run splashed (21 of 21), and so did every centreline run from the Streetfighter up.
  - Now: 42 of 42 reach it.
  - No run hits an edge hard enough to wobble on the way. 27 of the 42 land the truck hop with a wobble (the landing rule; every run from the Streetfighter up, and 3 of the Sport 600's), and none crashes.
- At the far truck, back onto the highway, the rider starts in either lane or the middle, and lets go or keeps to the centreline.
  - Before: 35 of 42 runs made it. A rider in the right lane who let go passed beside the narrow truck every time (7 of 7).
  - Now: 42 of 42 make it.
- The four bikes too slow for the hop (mobility scooter, lawnmower, golf cart, moped) all wake on the highway. The dirt bike clears the hop.
- With 12 seeded races of forced shoves at the turn-off (`tests/sim/ai-stay-on-highway.test.ts`), 3 rivals and cops went onto the old road. All 3 were back on the highway, and none went further than the turn-off connector. #489's note had 4 onto it.

Not fixed: a rider who keeps holding right after the split scrapes along the platform's edge over the water, which slows the bike. Measured the same way: on the Chopper and the Rustbucket that rider falls short of the hop and wakes on the highway, the Sport 600 clears it but is still scraping along the platform 30 s later, and from the Streetfighter up they reach the old bridge. Not phone-verified.

For devs:

- **The bake.** `tools/gis/networks/osm-keys-seven-mile.json` changes the leave: `offsetM` 3, the zone 80 m and d 3.5 to 8, and `turnRadiusM` 240, `turnDeg` 9 and `straightM` 520. The solve gives 9.4 degrees, a tightest radius of 230.6 m, a 71 m connector and a 591 m staging road, and the old bridge's first road (`osm-sm-old-east`) is 437 m shorter. Both trucks are now d −3 to 3, and both staging gaps have `respawn: "main"`.
  - It was re-baked through `tools/gis` from a fresh fetch. A first re-bake with no config change reproduced every road and junction byte for byte; only `provenance` differed (the dates, and the Overpass answer's hash). So every Seven Mile file's provenance changes here.
  - The README's Seven Mile notes are updated.
- **The paint.** `src/render/road-mesh.ts` clamps a split zone's fill, its inner line and its chevrons to the lanes' outer edges. A zone standing wholly past the edge, such as a truck-over-wall cut, is painted as before. A guided zone also gets chevrons over its lead-in. `guidedZone` reads a zone the way `sim/riders`' `splitGuideAt` does. `ZONE_LEAD_PAINT_M` and `ZONE_GUIDE_REACH_M` copy the riders' `SPLIT_GUIDE_LEAD_M` and `BIKE_HALF_WIDTH_M` (render may not import `sim/riders`), and the new sim test holds them equal.
- **The tests.**
  - `tests/sim/keys-seven-mile-turn-off.test.ts` (new): the turn-off and far-staging runs above, and the slow bikes' misses.
  - `src/render/road-split.test.ts`: a new check casts rays just past the lanes' edge along every zone that runs past it, on every baked network, and finds no paint there; it also checks that each guided lead-in has chevrons. Its negative control, with the clamp turned off, found 542 painted points past the edge on 5 networks. The old "nothing before the zone" check now allows the lead-in's chevrons, but not its fill.
  - `tools/gis/routes-keys-pt3.test.ts`: the old `zone.d0 > edge − 0.6` rule is replaced. Now the zone starts at least 1.5 m inside a rider's reach and more than 1 m past the right lane's centre, reaches past the edge, and is over 75 m long. The trucks must be as wide as the deck, every Seven Mile gap must wake a rider on the highway, and a moped falling at either hop must wake on the main path.
