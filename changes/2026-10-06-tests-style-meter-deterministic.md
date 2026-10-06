---
kind: dev
audience: dev
---
The browser test for the "Style pop-ups" setting went red once on CI ("chips with the setting off": got 1, expected 0) and green on the re-run. It cleared the top strip, fed a chip with the setting off, waited three drawn frames and then asked whether the strip's box was visible. The strip keeps its box on screen, with the last chip's class, for 160 ms after it is cleared (a fade-out timer), so on a runner that drew three frames in under 160 ms the test saw the cleared chip's ghost. The test now waits for one sim step (the same frame's HUD update follows it) and reads the strip's `up` class, which is set and cleared in the same update as what shows. It still checks that the chip shows with the setting on, that it does not with the setting off, and that the choice survives a reload. A new unit test (`ticker-view-strip.test.ts`) pins the mechanism with a counted fake clock. No game change; not phone-verified.
