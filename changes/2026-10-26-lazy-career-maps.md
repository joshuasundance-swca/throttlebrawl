---
kind: dev
audience: dev
---

The career maps no longer ride in the first-load JavaScript. Main's first load stood at 499.0 KB of its 500 KB gzip budget, so any new content would cross it; the four career files were about 8 KB of that. The game's registry now leaves `packs/*/careers/*.json` out, and the career's own lazy chunk carries them (`src/career/bundled.ts`), read through `careersOf`. A registry that carries its own career files, as the tests' whole-glob registries do, keeps them. The first load is now 490.8 KB gzip on the dev machine's build. The sim content hash is unchanged; the full content hash no longer counts the career maps. `scripts/first-load.test.ts` now also fails if a career map is bundled into the first load, or if one ships in no lazy chunk.
