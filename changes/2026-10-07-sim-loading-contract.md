---
kind: dev
audience: dev
---
The simulation exposes an asynchronous preparation step, `loadSimSteps`, through its public contract. Callers can await it before a race alongside the structure planners. Steps are still loaded eagerly in this change, so it resolves immediately and game behavior stays the same. This small contract change lands before the separate change that moves the steps off the first screen's download. No loading, replay, or performance claim depends on that later change having landed.
