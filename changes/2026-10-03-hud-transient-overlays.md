---
kind: fixed
audience: player
---
The two passing overlays no longer cover the race. Playtest 3 said "The black and white text pop-ups block the actual game", and the HUD rule is that nothing covers the road ahead or another HUD piece.

- The landing one-liner (the black-and-white line after a clean jump) used to float over your bike, in the middle of the road. It now sits centred just under the road ahead. On a phone held sideways it stays as wide as the road ahead, between the speed and health readouts and the touch buttons, so a long line wraps into two rows. Its letters are the same size as before.
- The "running slow" offer to switch to the Classic look used to sit top centre, over the bark bubble, the heat badge and the race objective. Where it goes now depends on the screen:
  - On a phone held sideways, the top of the screen is full, so it sits centred just under the road ahead, a little tighter, between the bottom corners' readouts and touch buttons.
  - On a phone held upright, it spans the screen just under the road ahead.
  - On a bigger screen, it sits in the top corner across from the pop-ups, under the pause button. If your layout is mirrored, it moves to the other side with them.

This clears the last 13 known overlaps in the browser HUD layout check: the top HUD cluster's PR (#428) cleared the other 7. The known list is now empty, and its cap is 0. The landing line lives in render's `air-pays.ts`, so this ui-lane PR also touches render's file, its unit test and its one call site. The content-packs doc now says where the line shows. Not phone-verified.
