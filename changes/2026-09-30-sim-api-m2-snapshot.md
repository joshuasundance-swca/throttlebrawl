---
kind: dev
audience: dev
---
Sim contract for M2: the snapshot gains `slowmo` (whether a takedown's slow motion runs, and its ticks left) and, per rider, `styleTally` (style cash this race) and `grudgeNotedBy` (who holds a grudge against this rider this race). The owning systems publish them through three `sim/world` helpers (`setSlowmo` for combat-4, `addStyle` for the race module, `noteGrudge` for tumble-2), so they reach the HUD, render and audio with no extra wiring PR. The facts are part of the state hash. Until those lanes land, every value stays neutral.
