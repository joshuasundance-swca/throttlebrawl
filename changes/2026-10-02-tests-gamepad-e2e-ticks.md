---
kind: dev
audience: dev
---
The two gamepad browser tests now hold and release the mocked pad for a count of sim ticks instead of a stretch of real time. They failed now and then on CI and passed on a re-run. The game reads the pad only when a sim tick steps, and the software-rendered CI runner draws about 10 frames a second with longer stalls between some of them. A 300 ms press or a 200 ms release could therefore start and end between two reads, so the game never saw it.

- **input-gamepad** (main's run 36981877768 and #303's first run: "Cross" recorded no attack press). Cross is now held until the recorded inputs show the press, then for 18 more ticks (300 ms at 60 Hz), and the test now also checks that those ticks read Cross down. Triangle is held for 6 ticks (100 ms) after the kick shows. Each release still waits until a recorded input shows it.
- **app-wire-seams, "gamepad d-pad up"** (#335's and #303's first runs: a 10 s timeout waiting for the helmet view). The release before the second press was never read, so the second press was no new press. The test now holds the first press for 18 ticks before checking that the view moved only one step, and waits for at least one tick after the release before pressing again.

No game code changes, and every check in both tests stays.
