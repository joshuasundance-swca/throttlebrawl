---
kind: changed
audience: dev
---

The browser checks now follow the selected base player and rivals in motion and verify each
rider's model geometry and contribution to the real camera view. Each observation includes a
same-rider hidden control and an unobstructed control, with normal and grayscale images for review.
The scene is selected by movement and proximity rather than a fixed seed or screenshot tick.

The existing player layout probe keeps its defaults and identity, alpha and depth controls.
Geometry aliases and a starter bike identical to its fallback remain ambiguous: these checks do
not certify asset-file identity, human recognition or phone readability.
