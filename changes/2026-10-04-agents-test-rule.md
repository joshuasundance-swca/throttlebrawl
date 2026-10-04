---
kind: dev
audience: dev
---
AGENTS.md's rule on tests gains one clause. A test asserts the rule it protects and reads content from the packs. It never pins a whole-game list, an exact count, pack text copied into the test or a lucky seed, so another lane's new content does not break it. It points at the gate's new "Assert the rule, not today's content" guidance in `docs/engineering.md`, which lands with the tests that were converted to follow it.
