---
kind: dev
audience: dev
---
The build stamp's negative control (`tests/e2e/ui-style-popups.spec.ts`, "the stamp check catches a control under the stamp ...") still failed once after #664 put the force and the measure in one task: main's own run on 310db5f (ci run 37606017903, browser slice 2) found the forced stamp over the Copy debug report button and not over the planted one, the same miss as trains 432 and 456. So the stamp, forced back to its corner, does not always sit where it was measured before the button was planted. Now the same task that forces it lays the planted button exactly over where it is, then measures. The control still fails if the check stops naming a control under the stamp. Not run locally (the keeper has no browser slot); CI's browser tier is the check.
