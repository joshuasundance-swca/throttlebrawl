---
kind: fixed
audience: player
---
Text pop-ups keep off your own bike and the touch buttons (playtest 3: "text pop-ups must not block the game").

- On a phone held sideways, a long career prompt (the in-air flip tip, the producer's asks) wraps inside the touch buttons instead of running under BRAKE.
- The "running slow" tip no longer sits over your bike and the riders beside it. On a phone, and on a narrow upright window, it takes the speech bubble's place at the top, and the bubble steps aside while it is up (the barks still play). Its words are shorter: "Running slow? Classic is lighter."
- The landing one-liner sits under your bike as the camera shows it, a little smaller when the room is short. The prompt steps aside for its 2 seconds.

For devs: the HUD layout check (`tests/e2e/ui-style-popups.spec.ts`) now measures the player's bike as a piece (its screen box, projected through the race camera), puts every career and tutorial prompt in the prompt box, and reads the landing line with the slow-frames tip up beside it. Its upright case now races as a narrow window with a fine pointer, the only way the game races upright (a touch device held upright gets the rotate screen). Render marks its canvas `data-landing-line` while the one-liner shows; ui sets `--touch-reach` and `--touch-rise` on `#ui` from where it places the touch buttons.
