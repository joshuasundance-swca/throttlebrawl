---
kind: dev
audience: dev
---
Local browser test runs no longer share port 4173. Each run now serves its build on a free port of its own, so two lanes testing at once on the dev machine can't test each other's build by mistake. Three lanes reported signs of exactly that on 2026-09-30. CI still uses 4173, and `PREVIEW_PORT` picks a port by hand; only then does a run reuse a server that is already running. `npm run preview` and the phone forwarding are unchanged.
