---
kind: dev
audience: dev
---

The career garage's bike-row views now accept an optional `handlingNote` plain string for a
comparison with the currently ridden bike. Quick Play already accepts an option note, which the
implementation will reuse. Existing producers and consumers stay
valid because the field is optional. This contract-only change has no shipped visible behavior yet;
the coordinator's implementation PR will derive the note from authored acceleration, braking, and
steering values and render it with the documented controls.
