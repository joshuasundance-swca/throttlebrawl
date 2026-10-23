---
kind: dev
audience: dev
---
The pre-push hook now prints each check's result as soon as that check finishes, so a type error no longer waits for the unit tests to finish before appearing. Passing checks still show only their summary lines, and failed checks show their full captured output. Both checks still start together, all selected work must finish, and either failure blocks the push. This changes when results appear, not how long the checks run or which checks are required.
