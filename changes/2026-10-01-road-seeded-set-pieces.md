---
kind: dev
audience: dev
---
Boost pads and ramp trucks can now be candidates in a slot (`params.slot` on the road feature): each race's seed picks one candidate per slot, through `chooseSetPieces` in `road/`, and the riding model only sees the picked one. No live track uses slots yet. The keys-m1 candidates wait until the game also draws only the picked set pieces (the app or render half), so a truck is never solid but unseen.
