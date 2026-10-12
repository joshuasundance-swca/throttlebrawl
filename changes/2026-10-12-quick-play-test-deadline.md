---
kind: dev
audience: dev
---
The Quick Play event tests now have a 90-second overall deadline for their two boots and real
race launch. CI exhausted the default 30 seconds while reopening setup after a successful
launch and reload. The event, HUD, law, opposition, career-preservation and saved-selection
assertions keep their existing rules, as do their readiness limits. This changes the test
harness, with no gameplay, performance budget or CI job-budget change.
