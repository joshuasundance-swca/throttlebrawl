---
kind: dev
audience: dev
---
Unit tests now time out after 20 s instead of Vitest's 5 s default, and sim tests after 90 s instead of 60 s. When several lanes build and test on the dev machine at once, passing unit tests with no timeout of their own (selftest, lint-rules, peds) took 6 to 9 s and failed the pre-push hook at random, while CI stayed green. The new limits leave at least twice the slowest time seen (8.9 s for unit, 26 s for sim), so a real hang still fails. What each test checks is unchanged, and tests that set their own timeout keep it.
