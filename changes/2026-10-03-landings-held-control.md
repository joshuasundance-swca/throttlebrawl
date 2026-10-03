---
kind: dev
audience: dev
---
The forgiving-landings sim test (brake or kick held in the air on every route) now checks a down against a control race before blaming the air command. When a race has a down, the same race runs again with the same take-over and no command; a down the control also has, at the same tick for the same cause, is the road's and is printed, not failed. Why: the new Chinatown & North Beach route meets an oncoming rental sedan 16 ticks after a clean landing on seed 1, held command or not (checked both ways), and the test counted that head-on as a wrecked landing. A down the command causes still fails, and a green run costs no extra races.
