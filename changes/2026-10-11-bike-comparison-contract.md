---
kind: dev
audience: dev
---

The career garage and Quick Play bike-row view contracts now accept an optional `handlingNote`
plain string for a comparison with the currently ridden bike. Existing producers and consumers stay
valid because the field is optional. This contract-only change has no shipped visible behavior yet;
the coordinator's implementation PR will derive the note from authored acceleration, braking, and
steering values and render it with the documented controls.
