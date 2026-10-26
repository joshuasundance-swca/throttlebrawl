---
kind: fixed
audience: player
---

On Eagle Point's park loops, a cop no longer leads a crawling convoy. The loops are one lane, one way and have no shoulder. A cop who had pulled out ahead of you, or had nobody left to chase, would crawl on in the lane at walking pace, looking for a shoulder that isn't there. Every car behind him crawled too, and so did you behind them, sometimes for minutes. Now, when he's ahead of you or has nobody to chase and has no shoulder to pull onto, he rides on, at least as fast as the traffic cruises, so no car queues behind him. Behind you he still slows down, as before. The Survey Run ridden by the test bot went from three of four seeds held at a walk for over two minutes to every seed finishing, the rider never held below 5 m/s for more than 1.8 s at a time.

For developers: the rule is in `drive` in `src/sim/cops/step.ts`. A road with a shoulder is unchanged. `tests/sim/cops-no-shoulder.test.ts` measures it on main's Survey Run, with the same check failing on the code before the fix.
