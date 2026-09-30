---
kind: dev
audience: dev
---
The real pack checker (M1 content-1). `npm run packs:check` now validates every file under `packs/` as strict JSON against its type's schema, then lints what one file cannot see on its own: references resolve to an entry of the right type (pointing at a vetoed entry fails; a live entry pointing at a draft, or a bark line naming a rider that does not exist yet, only warns; a cross-pack reference must name a declared dependency), ids (filename equals id, folder matches type, one id per type, `idAliases` without chains or reused ids, unique item ids inside an entry), public safety (the name of the game this one is inspired by never appears in display text or ids, and authors are roles such as `agent` or tool paths, never people), the weapon steal window (inside the wind-up, checked in ticks) and tuning preset keys (declared, in range). Every message names the file and a JSON pointer. Other lanes add rules as hooks; the road lane's `tools/road/pack-rules.ts` switches on when it lands.

It also writes the generated `pack.index.json` (sizes and SHA-256 hashes, plus asset manifest rows) to `.cache/packs/<id>/`, never committed. The loader and the checker now share one parser, the loader drops vetoed items (bark lines, signs, billboards, station tracks) as well as vetoed entries, and the content hashes are the real ones: the sim hash covers only the sim-facing fields listed per type in the schema folder, so a bark or a paint edit changes only the full hash.

Three `[default]` doc notes in content-packs.md say where the index is written, how the sim-facing list is kept, and how rule hooks plug in.
