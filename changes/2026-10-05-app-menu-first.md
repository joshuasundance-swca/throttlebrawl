---
kind: changed
audience: player
---
A new player now lands on the main menu, with "Start career" as the obvious first tap, instead of being dropped into a race. This is what happens on a fresh phone, or after clearing site data: the first tap past the title goes to the menu, and the career button reads "Start career" and is drawn in the red-orange of a button to press. It opens the career map with the tutorial event suggested, and once the career has started the button is the plain "Career" again. The first-event prompts still teach the controls as you ride it.

Also: the build stamp in the corner now steps away from the words on the menu as well as its buttons, including the what's-new card's first line, which it used to sit over on a short phone held sideways (568 by 320).

For devs: `src/app/index.ts` loses the race-first start (`raceFirstOn` and its `__raceFirst` test flag, and `firstRace` in `src/career/`); the career file's `firstRun` field is kept but nothing reads it (docs/content-packs.md). `src/ui/menu-first.ts` holds the button's words and look, and the menu's words join the stamp's avoid list (`STAMP_TEXT_SCREENS` in `src/ui/index.ts`). The browser specs that rode the first race by a first tap (`career`, `ui-hud-layout`, `ui-style-popups`, `ui-ticker`, `app-fresh-seed`) now go through the menu, with `tests/e2e/career-start.ts` as the shared path. `tests/e2e/ui-menu-first.spec.ts` measures the menu at 568x320, 640x360, 740x360 and 915x412: the first tap on the screen and hit by a tap at its centre, and the stamp over no word, with a negative control that plants words under it. Browser specs were not run on the dev machine (CI runs them). Not phone-verified. The first-load JavaScript measured 443.1 KB gzip locally, 56.9 KB under its 500 KB budget.
