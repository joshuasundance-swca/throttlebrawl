---
kind: changed
audience: dev
---
The top ticker and the HUD fixes from the same morning now work together. On a phone, the "Running slow? Classic is lighter." offer takes the ticker's spot at the top while it shows, and the strip steps aside until it goes (it used to be the bark bubble that stepped aside). On a big screen the offer still sits in the outer quarter across from the position badge.

For devs: the layout check keeps both changes: the ticker as the measured strip, and the player's bike, the touch buttons and every career prompt as pieces. The sky-colour check in `render-looks.spec.ts` hides the strip for its capture, because the strip now sits in the band it samples. `bark-voices.test.ts` reads the bark event names from `ui/narrative/voice-link.ts`, since the bubble file is gone.
