---
kind: dev
audience: dev
---
The browser control for lazy chunk retries now serves invalid JavaScript on its first request. Chromium 156 fetches again after a dropped or 404 module request, so the old control's claim that those network failures were cached was wrong. A module parse failure is cached under its URL: three imports of the plain URL throw after one request, while an import with a retry query fetches the valid chunk.

The game tests for a dropped first request and repeated 404s across races and a deploy remain in place. This change corrects the control's premise without changing the game's loader, retry behavior or timeout.
