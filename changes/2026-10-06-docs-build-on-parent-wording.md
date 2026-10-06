---
kind: dev
audience: dev
---
Wording from the second review of the build-on-parent rule: the change note no longer says `gh stack` is built only for a merge queue (its merge lands the whole stack at once, directly or through a merge queue, never through the train) and now names the `--no-track` branch, the `push -u` and the 8-hour bound; AGENTS.md says a branch that tracks the parent's would fail to push, or push onto the parent's PR; the 8 hours count from when your branch was ready; the steps are tagged `[default]` (the coordinator's), the rule itself `[decided]`; and `scripts/stack-lite-docs.test.ts` pins the sentences that had no pin (why `--no-track`, adjacent lines, the Branch bullet's pointer, the tags).
