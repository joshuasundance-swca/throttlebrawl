---
kind: dev
audience: dev
---
The Quick Play event tests now have a 90-second overall deadline for their two boots and real
race launch. CI exhausted the default 30 seconds while reopening setup after a successful
launch and reload. The event, HUD, law, opposition, career-preservation and saved-selection
assertions keep their existing rules and explicit expectation limits. This changes the test
harness, with no gameplay, performance budget or CI job-budget change.

The caption browser test now checks a real packed line's readable display, then drives
replacement and clearing through the existing test hook. It checks the active strip state and
includes controls for a bark-only locator missing a replacement and stale fade attributes.
Its wall-time expiry and elapsed-time assertions are removed: the ticker uses an injected
clock, can freeze or be preempted, and extends for decoded speech. Exact natural expiry stays
covered by the existing model and view unit tests. The browser check proves rendering and
controlled removal; it no longer claims natural end-to-end expiry timing.
