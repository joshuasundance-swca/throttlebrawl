---
kind: dev
audience: dev
---
CI's sim slices fit their 10 minutes again. Twelve sim files that landed on 2026-10-05 had no measured time, so the slice plan priced each at the table's mean (51 s); three of them take minutes (`traffic-cart-live` about 264 s, `drift-room` about 220 s, `traffic-sidewalk-dodge` about 157 s). The slice that drew them ran 590 to 595 s and was cancelled at its 10-minute timeout on four PRs (#553, #562, #565, #567) with every test passing. The timing table now holds the average of four green PR runs that had those files (37393591610, 37392530892, 37392139243, 37388889274), and every sim file is measured. Planned CI seconds per sim slice: 293 / 325 / 325 / 326 / 325 / 325 before (on the old table, short by the unmeasured files' real time), 395 / 386 / 386 / 386 / 386 / 386 after. No timeout or slice count changed.
