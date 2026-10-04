---
kind: fixed
audience: player
---
Text pop-ups keep off your own bike and the touch buttons (playtest 3: "text pop-ups must not block the game").

For devs: the HUD layout check (`tests/e2e/ui-style-popups.spec.ts`) now measures the player's bike as a piece (its screen box, projected through the race camera), checks every career and tutorial prompt in the prompt box, and reads the landing line with the slow-frames toast up beside it.
