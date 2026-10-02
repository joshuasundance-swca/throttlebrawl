---
kind: dev
audience: dev
---
The forgiving-landings batch test now counts a crash in the second after a landing only when that landing was a wobble, which is the landing's own consequence. A crash after a clean landing (a car ahead, a rival's hit) is still printed, as `afterClean:<cause>`, but no longer fails the batch. Main went red on one bot ride into a car right after a clean landing, which any traffic change could cause.
