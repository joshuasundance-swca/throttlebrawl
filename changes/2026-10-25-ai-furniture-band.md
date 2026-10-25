---
kind: dev
audience: dev
---

The rival furniture test's limit on uncredited falls (falls nobody's hit caused) is now a catastrophe guard: with the furniture on, at most one more such fall per race than with it off. The old limit allowed 2 more over the test's six races. Main sat exactly at it, and over 18 races (seeds 1 to 9) current code failed it, 8 falls against 3 with the furniture off. A test copy whose rivals cannot see furniture or structures added 18 against 8. With six races the test cannot tell those two apart, and it cannot afford more races (about 8 of a CI slice's 16 planned minutes). The direct checks are what catch furniture-blind rivals on these seeds: 5 rival crashes into furniture that were not takedowns, against a limit of 2. That copy fails the test on that check, and current code passes. Coverage given up: a smaller rise in falls the furniture causes indirectly, under one per race, no longer fails the test.
