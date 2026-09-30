---
kind: dev
audience: dev
---
Main went red on a passing test: with traffic and pedestrians now live, replay-1's "replays every race to identical state hashes" took 5.8 s on the CI runner, past Vitest's 5 s default. Tests in the sim project run whole seeded races by design, so that project's default timeout is now 60 s. Nothing about what the tests check changes, and each race keeps its own tick cap.
