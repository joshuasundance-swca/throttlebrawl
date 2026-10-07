---
kind: fixed
audience: player
---
A high fall is a clean cut-away again. Over the Golden Gate's railing, off Chuckanut's bluff or the Gorge, the rider and the bike used to stop in mid-air about halfway down and hang there, in full view, for the whole penalty. Now they fall the whole way and go under the water, so the held camera never shows anything hanging or lying still. A low splash (the Seven Mile Bridge) still floats you, with its gag.

After any fall over the edge you now wake in the same kind of place: back on the road where you went over, in the middle of a lane going your way, the one nearest where you went over, and the next lane over if a car stands in it. The Seven Mile Bridge used to put you against its rail, and the Golden Gate by the centre line.

The Golden Gate no longer draws a wide red walkway past its railing. Nothing could stand on it (past the railing is the drop), so the bodies seemed to tumble across it and then fall through it. The deck now ends at the railing; the steel under the cables is still there, below the deck.

For devs:
- `src/sim/tumble/index.ts`: `OVERBOARD_MAX_TICKS` is 10 s, a safety only, not 3 s. Ten seconds is a free fall of 490 m, and the highest drop past any route's edge is 223 m, at the Gorge's Crown Point. A body the cap ends now goes into the water (`intoWater` in `rig.ts`), never stopped where it is.
- From a high drop (`over.high`), a splashing body goes 3 m under (`HIGH_PLUNGE_M`). In `src/render/views.ts`, a crash body under the water throws no blob shadow, so no still dark patch is left on the surface.
- `respawnD` is the one respawn rule. It also applies after a gap, where the gap's own rule still decides how far along the road.
- `src/render/landmarks.ts` `deckEdgeCut`: the kit bay's vertices at its widest, at the deck slab's height, move in to the edge of its `deck_w_m`.
- No new sim state. Recordings of a fall over 44 m (only possible since 2026-10-06) or of a splash respawn replay differently. Same-build record-and-replay holds: there is a new Golden Gate case in `tests/sim/over-barrier.test.ts`.
- Tests, each with a control:
  - `tests/sim/high-riders.test.ts` takes the sim's own snapshots from the `railOver` to the `respawn` at the Golden Gate, Chuckanut and the Gorge. No crash body is still and inside the phone's view of the camera. Both controls are seen by the same check: the old 3 s cap, and the bodies left afloat. The cap is also checked against every route's highest drop.
  - `tests/sim/over-barrier.test.ts`: the lane on both bridges, crossing either side, plus a truck in the lane.
  - `src/sim/tumble/gap.test.ts`: the lane rule after a gap.
  - `src/render/high-fall.test.ts`: no shadow from a body 3 m under the water. The control is a body afloat, which does throw one.
  - `src/render/landmarks-sf.test.ts`: the drawn flat area past the railing at the deck's height is 0. With the bays left whole, the same check finds 1,146 m² near and 573 m² at the mid level.
- Not phone-verified.
