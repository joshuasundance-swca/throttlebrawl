---
kind: fixed
audience: dev
---

The train now gives an otherwise eligible PR's selected pending quick check one direct read
of that exact check before deciding who can ride. Only a completed success matching its safe
check ID, current head, name and GitHub Actions app can make it ready. Missing identities,
failed reads and inconclusive results keep the PR waiting. Logs record both observations so
future delays can be diagnosed; this adds no polling or extra train dispatch.
