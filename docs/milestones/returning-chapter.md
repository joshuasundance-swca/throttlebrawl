# Returning career chapter

`[default]` On a fresh page, Career opens the latest usable chapter played in the
current season. History array order decides recency; wins, losses, busts and quits
all count. A result must name a loaded chapter by its bare region id and a node
that still belongs to it, and the existing chapter-opening rule must allow it.
The historical event may differ from the node's current event: this restores a
chapter, not a race. Without usable history, keep the first-chapter fallback.

Initialize this choice only when the lazy career module loads. Explicit chapter
choices, imports, New career and Start Season keep their existing behavior. No
save format, progress rule or race-start rule changes.

## Automated acceptance

1. Fresh history and empty definitions return null, preserving the app's first
   chapter fallback.
2. A content-derived later-chapter result returns its bare region for every
   recorded outcome, including lost, busted and quit, without prior boss flags.
3. The newest usable array entry wins regardless of timestamps. Neither input
   changes.
4. Missing result season means Season 1 only. Skip past-season, future-season,
   free-play, unknown-region, qualified-region, removed-node and mismatched-node
   rows; continue to an earlier valid current-season row, or return null.
5. A historical event replacement with the same current chapter/node association
   remains usable.
6. Actual startSeason retains past history but returns no chapter before this
   season's first result. Actual newCareer clears history and returns no chapter.
7. In the browser, save a content-derived later-chapter result, reload, enter via
   Start/Career and verify its visible title and selected chapter tab. Then choose
   the first chapter, return to Menu and reopen Career: the explicit choice stays.

Existing season and backup-import tests retain the other reset/import controls;
this task does not duplicate their broad scenarios. The browser regression runs
in CI and uses persisted fixture data and DOM state, with no timed or frame waits.
