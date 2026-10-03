---
kind: dev
audience: dev
---
When main's checks fail on the first try, a small new workflow (`rerun-main.yml`) runs the failed jobs once more by itself, but only while that commit is still main's newest; a newer merge's own run decides instead. A flaky test alone then no longer holds main red until someone notices: on 10-03, main sat red for 42 minutes on a frame-time jitter its PR had passed. It never re-runs a second attempt or a pull request's run, its token can only re-run workflows and read main, and every decision is written to its run summary, so the list of its runs is a ledger of flakes still to fix. On 10-02's data it would have fired on 5 of the 13 red main runs. Docs: engineering.md's CI section, the repo layout and the "main red after a merge" note.
