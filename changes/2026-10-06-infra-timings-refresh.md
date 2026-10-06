---
kind: dev
audience: dev
---
The table of measured CI seconds per test file (`tests/timings.json`), which splits the unit, sim and browser tests into CI's parallel slices, is refreshed from the five newest green full-suite runs. Four are main runs: 37418801318 (the first after #585, green on its re-run), 37418143053, 37416650289 and 37414268174. The fifth is bundle train run 37415387312. The old table was a day out of date. It priced the every-setting browser test at 253 s, but it now averages 377 s, and it had no time at all for `render-quality.spec.ts`. So browser slice 5 of 7 held 465 s of tests by today's times while it was planned at 351 s. It took 593 to 610 s against its 10-minute limit, and on main `816d8d82`'s first attempt it timed out again.

Planned seconds per slice, before and after the refresh:
- browser: 359 / 350 / 352 / 351 / 351 / 354 / 351, now 377 / 372 / 375 / 374 / 373 / 373 / 374;
- sim: 395 / 386 / 386 / 386 / 386 / 386, now 309 / 436 / 436 / 436 / 436 / 436;
- unit: 205 / 205, now 239 / 239.

Priced with today's times, the old browser slices were 231 to 465 s and the old sim slices 309 to 443 s. The every-setting test now has a slice of its own. Since #585 its three parts run side by side on two workers, so that slice should take less than its plan. No file is unmeasured now. Not phone-verified (no game change).
