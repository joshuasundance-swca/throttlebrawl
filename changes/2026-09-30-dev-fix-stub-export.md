---
kind: fixed
audience: dev
---
Main went red: dev-1 (#46) dropped `createStubBot` from `src/dev/index.ts` while gis-1 (#45), merged just before it, imported it from there in `tools/gis/osm-route.test.ts`. Each PR was green alone. The export is back, so the gis route test and the build run again.
