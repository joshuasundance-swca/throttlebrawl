---
kind: dev
audience: dev
---
The browser test that rides to each region's road events (the hay truck, roadwork, speed trap and parade in the Pacific Northwest, the crash scene in San Francisco) no longer reloads the game for every seed it tries. It took 390 s on main's CI run 37418801318, because it rode seeds 1 to 7 in the Pacific Northwest and 1 to 8 in San Francisco, and each seed paid the game's boot again (11 to 13 s on CI). Now only each region's first seed loads the page; every later seed goes back to the menu the player's way (pause, Quit to menu) and taps Race again, which builds the race by the same app path with a fresh bot. The test also checks that each race it rides is the seed and region it asked for, from the race's recording. The seeds, the pieces met on them and every check at each piece (drawn, its sign, not blank, the draw budget, no console errors) are unchanged. Not phone-verified (no game change).
