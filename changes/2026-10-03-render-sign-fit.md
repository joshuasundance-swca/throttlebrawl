---
kind: fixed
audience: player
---
Signs no longer cut off long words. The cops' END OF JURISDICTION sign read "RISDICTI" in every region, San Francisco's speed-trap sign read "ONITORE", and the Pacific Northwest's FIREWOOD stand sign was cut at both edges. Signs only shrank their words to fit the height, so one word wider than the sign never shrank. Now the words also shrink to fit the width. Billboards, road-event signs and the roadside scenes' signs all share this fix, and the lane-vote gantry (which already fitted its one line) now uses the same fitter.

Many road-event signs had the same problem: under a font table check, 23 of the 32 event-sign texts in the packs were cut before this fix, plus one Keys roadside sign on its narrowest panel. A new unit test checks every sign, billboard, career receipt, event sign, gantry choice and roadside-scene sign in the packs against its panel at the size it is printed. It measures with Helvetica Bold widths plus 15 % to spare, so a later text that is too long fails the test instead of reaching the road. Not phone-verified.
