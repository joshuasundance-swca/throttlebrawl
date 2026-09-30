---
kind: dev
audience: dev
---
Contract PR for cops-1 (M1). `src/sim/types.ts` gains three additive things: a `cop` controller kind (an in-sim AIController that `sim/cops` runs in the cops phase, so the controllers phase skips it), an optional `law` block on `SimRiderDef` (agency, bust radius and dwell, fine, pursuit speed scale, from the rider file's `law` block), and a `siren` event type (the chase cue for audio-1). `src/sim/api.ts` re-exports `SimLawDef`.

architecture.md, `[default]` additions that record the design rather than change one: the controllers section says where the cop's controller lives and that its command lands one tick later, and the SimEvent list names `siren`.

Nothing reads the new fields yet; cops-1 fills in `src/sim/cops/`, and the integration lane's `buildSimConfig` puts the cop in the field.
