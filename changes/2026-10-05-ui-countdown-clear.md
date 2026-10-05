---
kind: changed
audience: player
---
The 3, 2, 1, GO countdown no longer covers the road ahead. The number is now small and see-through, in the strip beside the road on the left, so you can read the grid and plan your start while it counts. The beeps and the timing are unchanged. For devs: `src/ui/countdown-view.ts` moves `#countdown` out of the road-ahead box (the middle half across, 25 to 65 % down) into the left quarter at 45 % down; `tests/e2e/ui-menu-first.spec.ts` now measures the number clear of that box, small, and off every other HUD piece, at 915x412 touch, 412x915 and 568x320 (plus 640x360 and 1366x768), and checks the box test can fire. Not browser-run; the CI browser tier is the check; not phone-verified.
