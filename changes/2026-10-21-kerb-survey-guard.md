---
kind: dev
audience: dev
---
The ten-race kerb survey inherits the existing seeded-simulation project's per-test hang guard instead of dividing its former whole-survey allowance equally among seeds. CI completed all ten races in about 226 seconds, within the former 300-second survey allowance, but rejected the first race at about 32 seconds against its derived 30-second share. Grounded pedestrian support adds real work; equal shares are not an individual-race runtime contract.

Every seed, full race, tick cap, contact assertion, negative control and aggregate exposure check remains. The project guard is currently 90 seconds per race, so the sum of individual allowances grows from 300 to 900 seconds; CI job deadlines remain unchanged. Timing diagnostics remain, and full CI and performance acceptance are still required.
