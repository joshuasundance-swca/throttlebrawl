---
kind: dev
audience: dev
---
Sim contract for M2: the event list gains `slowmoStart` and `slowmoEnd` (a takedown's slow motion), `railOver`, `splash` and `respawn` (going over a bridge rail), and `getUp`, `fistShake` and `grudgeNoted` (a knocked-off rival getting up, blaming you and holding a grudge). `takedown` now documents its `data.kind` (traffic, scenery or health) and `style` its `data.kind` (the five style-cash sources) and `data.points`; both lists are exported as constants so audio, the HUD and barks key on one spelling. Type-only; nothing emits the new events yet.
