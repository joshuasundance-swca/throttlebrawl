---
kind: fixed
audience: player
---
On a phone held upright, the wheelie gauge no longer stands right under your bike. It used to sit about a centimetre below the back wheel, so a kick's leg reached it; it now stands beside the speed and health readouts, clear of the bike.

For devs: `ui/hud-layout.ts` has `BIKE_ZONE` and `bikeZoneBox` (`[default]`): centred across, 0.09 of the screen's height to each side, from the road ahead's bottom to 82 % down, from the bikes the browser check measured. `placeGauge` keeps its top tier off it as it does the road ahead; on a screen held sideways nothing moves (the gauge was already clear of it on every screen and every thumb point the unit sweep tries). The keeper found it in PR 513's browser run, where the layout check reported `hud-wheelie × player-bike` on the 412 by 915 case; `src/ui/moves-meter.test.ts` now checks the gauge at rest against the zone on every screen, both hands. Not phone-verified.
