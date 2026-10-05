---
kind: fixed
audience: player
---
A paid trick's cash chip now shows right away. Landing a double backflip used to put "DOUBLE BACKFLIP +$240" on the top strip 10 seconds or more after the landing, behind earlier chips and rival barks, so the flip and its cash felt unrelated. Now a paid chip takes the strip within about a second of the landing: a rival's bark or the landing one-liner it interrupts waits and comes back right after it. A takedown name, a hint or the producer's ask still go first.

For devs: `src/ui/ticker.ts` (`rankOf`, `outranks`: a paid chip ranks just above a bark; a landing line it takes the strip from is frozen and resumes, and a line behind a paid chip is not stale). `docs/architecture.md` "One top ticker" is updated. Not phone-verified.
