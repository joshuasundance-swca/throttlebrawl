---
kind: dev
audience: dev
---
County and park facilities share one physical-box renderer, including sign inspection, wording vetoes, distance handling and visible lower faces. Geometry checks compare actual rendered faces with contact surfaces and detect a displaced model, without requiring a particular vertex order or count.

County site positions and kinds come from authored road features. A small existing roadside-zone ground overlay stays within pre-existing connected land; it does not extend the course. Pack versions and AI-generated asset credits include the new regional places. Regional character and riding choices have about equal priority; pairing them within these content slices is an implementation choice.

Park and county facilities share a lazy loading lifecycle while retaining their separate content, physical layouts and inspection counts. Tests exercise actual placed facilities, wording vetoes and disposal, including an unrelated-route control. Consistent fun remains the overall goal; these checks do not substitute for human play.

Review caught a loading simplification that violated failed-download recovery. Each renderer and layout import now keeps its own retry boundary; a failed layout stays unavailable until a later race can retry it, and stale presentations cannot install the result. The existing import-contract test demonstrated the defect before the fix.
