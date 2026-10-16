---
kind: fixed
audience: dev
---

Committed traffic lane maps load with the existing simulation rules instead of the first screen.
The menu still initializes without those rules. Lane order is determined on the physical road
before applying path offsets, retaining inner-to-outer rank on shifted and reversed paths.
