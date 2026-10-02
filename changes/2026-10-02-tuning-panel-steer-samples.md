---
kind: dev
audience: dev
---
The tuning-panel browser test that changes steering mid-race now rides 1,200 ticks instead of 420, so a slow CI runner still has enough sampled ticks to compare between runs. It samples one tick per drawn frame, and at peak load some PR runs shared only 6 ticks after the change, below the test's floor of 10. The floors and checks are unchanged.
