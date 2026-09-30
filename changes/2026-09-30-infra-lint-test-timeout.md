---
kind: dev
audience: dev
---
The real-folder lint test (`tools/lint/real-folders.test.ts`, the one that runs ESLint over all of `src/`) now has a 60 s timeout instead of Vitest's default 5 s. On the dev machine, with several lanes building at once, the lint pass took 5.5 to 8.9 s and the test timed out with no lint finding, which failed the pre-push hook for unrelated changes. With the longer timeout the same test passes (3 of 3), and it still fails on any real finding. No check was loosened: the rules, the file count assertions and the findings list are unchanged.
