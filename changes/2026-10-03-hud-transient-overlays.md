---
kind: fixed
audience: player
---
The two passing overlays no longer cover the race. Playtest 3 said "The black and white text pop-ups block the actual game", and the HUD rule is that nothing covers the road ahead or another HUD piece.

- The landing one-liner (the black-and-white line after a clean jump) used to float over your bike, in the middle of the road. It now sits centred just under the road ahead. On a phone held sideways it stays as wide as the road ahead, between the speed and health readouts and the touch buttons, so a long line wraps into two rows. Its letters are the same size as before.
- The "running slow" offer to switch to the Classic look used to sit top centre, over the bark bubble, the heat badge and the race objective. It now sits in the top corner across from the pop-ups, under the pause button; if your layout is mirrored, it moves to the other side with them. On a phone held upright it spans the screen just under the road ahead.

This clears 13 of the 20 known overlaps in the browser HUD layout check, and its cap drops from 20 to 7. The landing line lives in render's `air-pays.ts`, so this ui-lane PR also touches render's file, its unit test and its one call site. The content-packs doc now says where the line shows. Not phone-verified.
