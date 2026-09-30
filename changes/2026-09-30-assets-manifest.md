---
kind: dev
audience: dev
---
assets-1: the asset manifest is ready for the first real asset. `createAssetManifest(packIndex, {baseUrl?, fetchFn?})` maps ids to `baked`, `remote` or `procedural` sources. `load(id, standIn, {decode})` fetches a baked file relative to the build's base URL, reports per-asset progress (`progress()`, `onProgress`: status per id, done, fell back, bytes loaded and expected), checks the SHA-256 when the index carries one, and decodes it. Anything that goes wrong (the file is missing, the hash differs, decoding fails, the network is down, the id is unknown, or the asset is `remote`, which is a seam until the first remote asset ships) returns the caller's procedural stand-in with a plain reason instead of breaking the race. Each id loads once. `stream/` needed no change: it already activates the single M1 chunk at load and its "hold the sim until the data is loaded" check always says ready.
