---
kind: fixed
audience: player
---
The small build label in the corner no longer covers buttons. On a small phone held sideways (568 by 320) it sat over the menu's Race button. Now it is smaller, it never takes a tap, it moves to the other bottom corner when a button is under it, and it hides when there is a button under both. The menu and the pause screen still show the build in their own footers.

For devs: the choice is `src/ui/stamp.ts` (`pickStampSpot`, with a unit test); `src/ui/index.ts` measures the two corners and the visible controls on every screen change, resize and content change, and sets `at-right` or `yield` on `#build-stamp`. The text and its id are unchanged. The HUD layout check (`tests/e2e/ui-style-popups.spec.ts`) has its 568x320 case back, with the known list still empty, and a new test that walks the start screen, menu, every settings tab and the changelog at seven sizes (with a negative control) to prove no control is under the stamp. Not phone-verified.
