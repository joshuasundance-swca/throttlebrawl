---
kind: dev
audience: dev
---

The San Francisco bay rendering check now measures visible water in its original area instead of
averaging foreground pedestrians into the water and comparing it with a differently coloured sky.
It retains seed 3 and the same tick/site, selects golden-hour lighting explicitly, reads the pack's
water/fog palette and keeps ordinary movers. A rendered negative control restores the historical
floor-depth defect and must fail the same visible-water rule. No game rendering or limit changes.
