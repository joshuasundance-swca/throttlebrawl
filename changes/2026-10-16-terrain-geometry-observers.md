---
kind: dev
audience: dev
---

Terrain geometry checks now read authored land and water as well as generated roadside ground. They distinguish dry land from water, include deciduous scenery, and check authored faces for roads buried underneath them.

The regional check samples every authored face against both physical height and the drawn mesh, with a missing-mesh negative control. Shoulder seam checks also recognize authored land. The old closed strip/skirt guarantee remains for generated ground; bounded authored patches may deliberately have edges and holes, so they use the face checks instead. Existing floating-plate, bridge-scenery, ray-query and buried-road negative controls remain.

Render-only land scatter is intentionally absent on authored terrain until it has physical contacts; its tests assert that absence while retaining positive scatter checks on legacy ground.
