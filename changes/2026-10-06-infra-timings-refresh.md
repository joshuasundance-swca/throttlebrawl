---
kind: dev
audience: dev
---
The browser and unit times in the table of measured CI seconds per test file (`tests/timings.json`) are refreshed from the five newest green full-suite runs. Four are main runs: 37418801318 (the first after #585, green on its re-run), 37418143053, 37416650289 and 37414268174. The fifth is bundle train run 37415387312. The table splits the tests into CI's parallel slices. The old browser times were a day out of date. They priced the every-setting browser test at 253 s, but it now averages 377 s, and they had no time at all for `render-quality.spec.ts`. So browser slice 5 of 7 held 465 s of tests by today's times while it was planned at 351 s. It took 593 to 610 s against its 10-minute limit, and on main `816d8d82`'s first attempt it timed out again.

Planned seconds per browser slice, before and after: 359 / 350 / 352 / 351 / 351 / 354 / 351, now 377 / 372 / 375 / 374 / 373 / 373 / 374. Priced with today's times, the old slices were 231 to 465 s. The every-setting test now has a slice of its own. Since #585 its three parts run side by side on two workers, so that slice should take less than its plan. On this PR's run the browser slices took 346 to 550 s.

Unit, two slices: 205 / 205, now 239 / 239.

The sim times stay as they were (`simRuns` in the table names their runs), so the sim slices are unchanged: 395 / 386 / 386 / 386 / 386 / 386. Refreshed, they planned 309 / 436 / 436 / 436 / 436 / 436. On this PR's first run, slice 5 then timed out twice, at 617 s and on its re-run. Its three heaviest files ran side by side and each took about 1.25 times its table time, so the files it started last were still running at the 600 s limit. They were `app-cast-and-law` and `riders-race`, whose work Vitest's per-file time does not count, so the table prices them at 0 s. On the re-run they finished at 587 and 599 s. An even split by measured times packs heavy sim files together, and the plan does not see them slow each other down. The old split has passed on main and on trains, at up to 584 s a slice. Not phone-verified (no game change).
