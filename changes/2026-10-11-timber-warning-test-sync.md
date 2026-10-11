---
kind: fixed
audience: dev
---

The Timber warning browser checks now use the game's existing tick-driven fast-forward and slow
lockstep instead of a mocked clock. A normal Ride click handles the card being rebuilt when roads
arrive. All text sizes, warning phases and rendered assertions remain, with eligibility rechecked
while measuring and after each captured screenshot.
