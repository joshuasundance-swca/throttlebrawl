---
kind: fixed
audience: dev
---

The landing layout check now starts its 90 consecutive samples at the first paint-visible held
line. The ticker draws immediately, but its fade-in begins at zero opacity, so the previous check
mistook those invisible startup frames for missing coverage. A line disappearing after sampling
starts fails immediately. Every drawn player part, HUD overlap check and existing negative control
is retained; no overlap allowance or sample count changed.
