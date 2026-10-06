---
kind: dev
audience: dev
---
The table of measured CI seconds per test file (`tests/timings.json`), which splits the unit, sim and browser tests into CI's parallel slices, is refreshed from the four newest green full-suite runs: main runs 37418143053, 37416650289 and 37414268174, and bundle train run 37415387312. The old table was a day out of date. It priced the every-setting browser test at 253 s, but it now takes 388 s, and it had no time at all for `render-quality.spec.ts`. So browser slice 5 of 7 held 483 s of tests by today's times while it was planned at 351 s. It took 593 to 610 s against its 10-minute limit, and on main `816d8d82` (after #585 split that test into three parallel parts) it timed out again.

Planned seconds per slice, before and after the refresh:
- browser: 359 / 350 / 352 / 351 / 351 / 354 / 351, now 388 / 367 / 366 / 367 / 370 / 371 / 367;
- sim: 395 / 386 / 386 / 386 / 386 / 386, now 283 / 434 / 433 / 433 / 433 / 433;
- unit: 205 / 205, now 240 / 240.

Priced with today's times, the old browser slices were 232 to 483 s and the old sim slices 283 to 441 s. The every-setting test now has a slice of its own. Its three parts run side by side on two workers, so that slice should take less than its plan. No file is unmeasured now. Not phone-verified (no game change).
