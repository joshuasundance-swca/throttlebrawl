---
kind: fixed
audience: dev
---

The jurisdiction regression now observes actual police pursuit rather than combat targeting. Its
seed search requires a cop chasing the player immediately before the crossing, then verifies that
the pursuit stops and heat clears on the next tick. The old combat field failed that new positive
control even while the cop was pursuing, so its previous no-chase assertion could pass vacuously.

The test retains its seed and tick limits, event-stream replay control and the other regional law
checks. Omitting retained snapshots also omits the new pre-crossing snapshot. No gameplay, police
rules, timing guard or performance budget changes.
