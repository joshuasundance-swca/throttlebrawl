---
kind: new
audience: dev
---
content: the loader for region packs (`src/content/packs.ts`) and its contract in docs/content-packs.md, "Region packs at runtime". The build carries every folder under `packs/`: base whole, other packs' entry files in the bundle, and their baked road data as JSON files fetched the first time a race in that region starts, so the JavaScript budget does not grow with every road. Packs combine into one registry (base first, then dependency order); `packSubset` and `packClosure` give a race only its own packs, so carrying regions never changes the Keys race or its replay key. The app wiring that makes the menu's region picker start a race follows in its own PR.
