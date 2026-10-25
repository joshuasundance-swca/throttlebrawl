---
kind: dev
audience: dev
---

The perf check's sim step baseline is measured again from fifteen recent CI runs. The simulation step has roughly doubled since 2 October as regions, traffic and terrain were added, so slow CI runners were tripping the "3x" catastrophe guard on ordinary changes. The guard now sits at three times today's median; the doubling stays visible in each run's trend line.
