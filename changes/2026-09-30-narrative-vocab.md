---
kind: dev
audience: dev
---
The bark picker now reads its trigger list, fact vocabulary and condition operators from content's registry (`src/content/schema/vocab.ts`), the same one `packs:check` lints bark files against, instead of keeping its own copies, so a line the lint accepts is a line the game can read. A new test checks that the narrative answers every fact in that vocabulary, except the two career facts that wait for M4 and story flags.
