---
kind: dev
audience: dev
---
Add a pure full-run frame collector for the future 15-minute phone soak. It retains raw eligible intervals, exposes excluded transition gaps, and reports exact interval statistics plus minute medians of interval time and per-frame FPS. Cancellation and the retention limit freeze an explicit incomplete prefix; reaching the measurement target retains the final frame's overrun. This collector owns no clock or browser lifecycle and supplies no phone performance verdict. The existing rolling perf overlay is unchanged.
