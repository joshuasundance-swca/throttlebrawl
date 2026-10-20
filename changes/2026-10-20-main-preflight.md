---
kind: fixed
audience: dev
---
Main CI gains a shared check for its actual successful acceptance gate. A successful
workflow whose acceptance gate was skipped must not count as accepted main.
