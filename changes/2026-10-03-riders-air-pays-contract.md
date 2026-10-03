---
kind: dev
audience: dev
---
Contract for "Air that pays" (the pitch deck's #13). The snapshot gains `touchdown` on each rider: for a player in the air, where the bike will come down, the seconds to it and whether landing now would be crooked, so render can draw the chalk mark (red when crooked). The trick list gains `newspaper`, the lawn-chair-and-newspaper pose on the biggest jumps. The `land` event's doc names its new `surge` data (a clean landing after real air gives a short surge, rivals included) and the landing hit (`hit` with `weapon: landing`). A region file may carry `landingLines`, the local one-liners shown on a clean landing, shaped like signs so "cut this" can cut them; they are presentation-only and stay out of the sim content hash. Nothing fills or reads these yet: the follow-up PR on `lane/riders/air-pays` does.
