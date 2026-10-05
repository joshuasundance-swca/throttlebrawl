---
kind: dev
audience: dev
---
The career check "every route of a region has a career event" now waits for five named routes: Duval Street, the Seven Mile Bridge, Bridge City, the Golden Gate and Lombard. Playtest 3's wave B bakes these roads (T9.2 to T9.4) and wave C gives them their career events (T10.4 to T10.6, the real-world events and node swaps). Without the wait, no bake can go green on its own.

The list only shrinks: a listed route that gets an event fails the check until it is struck off, and every other route is checked as before. Each region must still have at least three routes outside the list with events. The check was shown able to fail: listing a route that has an event (`base:m1-skeleton-sprint`) failed it with "has an event now: strike it off AWAITING_EVENT". A listed route that is not in the packs yet is skipped, so the list can land before the bakes do.
