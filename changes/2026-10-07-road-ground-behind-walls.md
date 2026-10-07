---
kind: fixed
audience: player
---
The ground behind a roadside wall now stays solid and visible. At the Mill Yard, the wall beside the ramp cut was clearing away the forest ground behind it, leaving narrow holes where the two roads part and meet. Walls keep their collision and height; bridge rails still leave the drop below them open.

For devs: the road's land reach and the scene's land strip now suppress land only for rail spans. Scenery also keeps its footprint out of the split zones, so the restored ground does not put poles across the entrance to a cut. A regression checks the Mill Yard wall and the ground behind it together. The geometry sweep checks the real road junctions, strip seams, pedestrian ground and land over roads. Not phone-verified.
