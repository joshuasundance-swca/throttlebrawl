---
kind: dev
audience: dev
---
Contract: the sim gains one event type, `stealWindow`. combat-2 emits it when a held weapon's wind-up reaches its snatch window, so render can glint and audio can play a cue exactly when a steal would work. Actor is the holder, `data.weapon` names the weapon and `data.ticks` is the window's length. The architecture doc's event list names it too.
