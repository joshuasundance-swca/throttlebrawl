---
kind: dev
audience: dev
---
The browser test that rides a whole bot race to the results screen now gives the race 330 s instead of 200 s. On the software-rendered CI runner the sim runs at about 35 to 40 ticks a second, and since the road events landed the seeded race ends in a finish of about 7,500 ticks rather than a bust of about 6,300, which needs about 207 s. What the test checks is unchanged.
