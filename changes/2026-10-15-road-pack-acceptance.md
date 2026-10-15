---
kind: fixed
audience: dev
---

Clinton's two existing billboard slots now name their authored lines explicitly, so both lines are available on every run rather than competing for pooled slots.

The rural highway also gets smashable roadside mailbox rows, using the existing prop and placement rules. They stay clear of the lanes and require enough supported verge space.

Lane-drop coverage checks narrowing against the shipped road geometry instead of freezing the game's list of funnel locations. Existing named positive regressions, shortcut mappings and bounded-taper checks remain. Every observed funnel needs a physical inward boundary ahead, and stations without narrowing must have no funnel; new roads need no inventory update.
