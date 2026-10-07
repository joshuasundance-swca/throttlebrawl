---
kind: dev
audience: dev
---
The build stamp's negative control (`tests/e2e/ui-style-popups.spec.ts`, "the stamp check catches a control under the stamp ...") forces the stamp back over the planted button and measures it in one task. Forcing it changes the stamp's class, which queues the menu's own stamp check for the next frame, and that check could step the stamp away before a separate measure: trains 432 and 456 (main 5f083dd + #641 #650 #657) both found the forced stamp over the Copy debug report button, not the planted one. The fix is the one a keeper made on #651 (bbc140c), taken out on its own because #651 stays off the trains until its own browser tests pass.
