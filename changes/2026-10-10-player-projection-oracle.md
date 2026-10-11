---
kind: fixed
audience: dev
---

HUD overlap checks now measure the rider and bike's actual posed geometry, including separate bodies during a crash and get-up. The previous riding hull could report a bike at the walking rider or extend below the visible tyre after remount; that invalid overlap guarantee is replaced with per-bone geometry bounds. The original riding hull and its fit assertions remain as a separate calibration control, all planted overlap controls remain, and a new real crash-to-get-up control checks visible cover of both bodies. Landing checks complete all 90 rendered samples, including remount, instead of stopping early on a slow renderer. Camera behavior and layout allowances are unchanged.
