---
kind: dev
audience: dev
---
Sim contract for M2's feel visuals: each rider in the snapshot gains `tumble`, which is null except while the rider tumbles after a crash. It then holds the rider's and the bike's crash bodies (world position and velocity), read straight from the tumble system, so render-2 can throw the bike clear and cartwheel it apart from the rider. tumble-1's two bodies fill it today; tumble-2's rig keeps it filled with its body centres. It is presentation only and never touches the state hash.
