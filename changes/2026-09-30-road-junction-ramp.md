---
kind: new
audience: player
---
There is a shortcut now. Just after the start, hug the right edge of the road as the marina bends begin, and you peel off onto the Boat Ramp Cut: a straight service lane through the boat yard with a launch ramp halfway along. Hit the ramp, fly, land, and rejoin the highway at the bridge ahead of the riders who took the bends. Traffic never goes that way. Missing it is fine too.

For developers (M1 road-2):

- The road network has real junctions now. A junction with connectors owns short connector roads and a lane-level table; `nextEdges` lists every way on, `Edge.next`/`prev` stay the default way, and `advance` picks a connector when the mover's `d` is inside its split zone. `d` maps across a join by the geometry (`EdgeLink.dShift`), so the world position holds. `neighbours` covers every join and gains `dOffset`; `project` searches all of them; `splitZones()` lists the zones.
- End tangents use a second-order difference, so the frame at a road end is as true on a bend as inside it. On the junction test fixture this cut the step error at a join, 1.7 to 3.6 m off the centreline, from about 2 cm to under 1 cm.
- Routes: distance to finish covers the shortcut too (true distance along it; main-path distance on the main path), so progress never falls on either path. `RouteProgress` gains `mainEdges` and `shortcuts` (each split zone with the distance it saves), for the bot and the AI.
- The compiler builds branches (a Newton-solved turn, straight, turn between two points beside the main road), connector pieces, both junctions' lane tables (a row per drive lane, both directions, plus the cut's rows with the split zone), and ramps baked into the elevation with the lip on a sample.
- The road lint gains connector rows, split zones, the traffic rule (no drive lane on a connector into or out of a shortcut), connector junction ends, and the jump rule (`|kappa|` ≤ 0.002 from a ramp's start to its expected landing at 38 m/s). The grade rule skips ramp ranges.
- The M1 track: the marina S-bends now swing west first (road-1's shape, mirrored there; everything after is moved 220 m west but otherwise unchanged), the Marina Run is cut at 300 m, and the new roads are `m1-marina-bends`, `c-marina-split-main`, `c-marina-merge-main`, `c-boat-ramp-in`, `m1-boat-ramp-cut` and `c-boat-ramp-out`. The checkpoints moved onto roads both paths share. The main path is six edges, so three other lanes' tests that listed the three old edges now list six: `src/dev/bot/bot-race.test.ts`, `tests/e2e/bot-race.spec.ts` and `src/content/content.test.ts` (the road ids).
- `fixtureBranchTrack` and `fixtureBranchNetwork` give any lane a small compiled track with a split, a shortcut with a ramp, and a merge.
- Docs: the connector-row semantics, the as-built jump and ramp rules and the distance-to-finish rule are `[default]` notes in `docs/content-packs.md`, and road-2's section in `docs/milestones/M1.md` has an as-built line.
