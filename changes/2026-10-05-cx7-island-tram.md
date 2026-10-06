---
kind: dev
audience: dev
---
A short island tram model for Old Town (playtest 4, P4-19, identity sheet row D5, Codex batch CX7). The Keys' island tram is 7.5 m long and cannot grow, because the rival AI sizes every vehicle by the race's largest traffic type; the only tram model was CX2's 18 m one, so the tram still draws as a code-made shape. This one is built to the type's own size. Nothing draws it yet: the one row in `packs/base/assets/traffic-models.json` that does is a later change, with its draw-headroom check.

- **The model** (`base`, `models/traffic/island-tram`, 11,864 bytes, 606 triangles, 7 draws): an invented open sightseeing train, a jeep-like tractor with a flat launch hood and an upright framed windscreen, pulling two open bench cars under cream canopies with a scalloped fringe; three axles, 7.5 × 2.2 × 2.6 m. White primary paint takes the type's yellow, teal or cream. No operator, livery or lettering.
- **Tests:** new `tools/blender/cx7.test.ts` reads the GLB and the type file and asks the rules: the model is the type's size and no longer, it fits its byte, triangle and draw caps, ships no normals, winds every closed part outward (per role and across roles), has at least three axles, its hood and headlamps at the front, white paint for the tint, and no text surface. Written before the model; it failed on the missing GLB, and it fails on the 18 m tram.
- **Waiver:** `src/render/vehicles.test.ts` waives `models/traffic/island-tram` by name until its row lands (the test fails on any built vehicle model no row draws).
- **Budgets:** nothing is placed and no runtime code changed, so draw calls, scene triangles and first-load JavaScript are unchanged (`draw-headroom.test.ts` and `scene-cost.test.ts` pass; Duval's busiest view is still 101,082 triangles). The base pack's download grows by 11,864 bytes.
- **Not built:** the Keys tree kit (banyan, royal poinciana, frangipani; D7) and Portland's Chinatown gate (P7) were already built by CX5 (#535) as `keys-identity#keys_banyan`, `#keys_poinciana`, `#keys_frangipani` and `pdx-landmarks#pdx_chinatown_gate`; they wait for wiring, not for models.

Not phone-verified; no browser was run.
