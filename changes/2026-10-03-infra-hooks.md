---
kind: dev
audience: dev
---
Pushing is faster. The pre-push hook now type-checks with its three configs at once, and runs only the unit tests the push names (the test files it changed, and the tests named after the source files it changed) instead of every test that imports them; a push of docs and notes runs no tests, and a dependency or config change still runs the whole unit tier. Replaying one 36-file content PR with two test workers, the hook's work went from about 5 minutes (142 test files) to 36 seconds (10). CI still runs every test on every PR. The pre-commit hook now checks the branch's `changes/` note when one is staged, so a bad note fails at commit instead of turning CI red. The engineering doc's local loop now says lanes run no browsers.
