---
kind: dev
audience: dev
---
Contract for weird events that move (the pitch deck's #9, run W-T): two new prop kinds, `log` (a log shed across the road, rolling while `moving`) and `gantry` (an overhead lane-vote gantry; its two panels' words in `label`, split by ' | ', the winning side in `variant`, its width in the new optional `spanM`); a serial sign is a `sign` with variant `serial`. A new event, `setPieceBeat`, marks a moving set piece's moment (`unhitch`, `runaway`, `shed`, `vote`) for sound, barks and the camera. Nothing emits or draws them yet: the events-move PR that follows does. Render draws the two new kinds as its placeholder box until then.
