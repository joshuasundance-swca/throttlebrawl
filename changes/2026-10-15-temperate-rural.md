---
kind: new
audience: player
---
Rural roads can now use open grass and scattered deciduous copses. Their original procedural
trees have rounded crowns and branching trunks, without tropical palms or coastal or evergreen
tree substitutions. The scenery is repeatable for a race seed and stands on the drawn ground.

For devs: the opt-in `rural` scenery tag derives a soft grass verge and uses the existing merged
scenery and quality controls. Untagged roads keep their existing appearance. Tests cover water
priority, the untagged control, gaps between copses, deterministic placement and actual ground
and tree meshes on a graded bend.
