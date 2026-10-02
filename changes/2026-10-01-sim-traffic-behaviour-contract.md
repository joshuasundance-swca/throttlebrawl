---
kind: dev
audience: dev
---
Contract for W-P's traffic and people: a traffic type's `behaviour` can now say `kerb` (rides at the kerb, passed in lane), `weaveM` (weaves side to side), `convoy` (spawns nose to tail in a group), `strolls` (walks along the verge) and `chases` (a dog runs after you), and these reach the sim. A new `pedReact` sim event carries a pedestrian's reaction to a rider: a hop back, a fist, a phone held up to film, or a dog giving chase.
