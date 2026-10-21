---
kind: fixed
audience: dev
---
The furniture avoidance test now credits a furniture fall only when combat names the same rider and crash cause on the next simulation tick, once. A later unrelated takedown of that rider previously could hide an earlier uncredited furniture crash. Missing event identity now leaves the crash uncredited.

The comparison now applies its existing band to uncredited riding-to-tumble first falls. It counts these transitions directly and matches their credits separately; subtracting arbitrary takedowns from all contact events would let unrelated kills hide a real fall. The same routes, seeds, full world, tick cap, direct-furniture limits, exposure and furniture-off controls remain. Raw crashes, causes and already-down body contacts remain in diagnostics.

This deliberately replaces the old ceiling on all crash events, including valid combat kills and repeated already-down contacts. It does not preserve a statistical limit on either. The old assertion failed at 30 against 19, limit 26. A controlled single-seed experiment changing only registered traffic-body sensing changed the fights and hazard takedowns; restoring the old oversized boxes reduced credited falls but added uncredited collisions. Exact combat credit proves attribution, not optimal recovery. A separate real-controller post-shove recovery check protects an achievable escape and retains a forced-impact control. No game behavior or numeric band was changed by this test repair. Full CI and phone playtesting remain separate evidence.
