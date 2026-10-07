---
kind: fixed
audience: player
---
Past a barrier you meet what you see. Clear Chuckanut's parapet and land on its grassy shelf; clear the shelf and fall over the cliff. Crashed bikes and riders can travel over the barrier and settle on that ground. Mangrove land beside the road no longer acts like water at the road's edge. Falls near Lake Samish reach the lake where it is drawn and sea level outside its outline.

For developers: `beyondAt` reads the existing lake polygon and the road scene's ground rules. Curved terrain fans and roadside-zone strips are queried as world-space triangles, so a switchback's other leg and a hillside below a bridge meet the same floor the renderer draws. Exact world points replace the rounded ground cache. Ground remains behind tagged roadside walls, and scenery stays clear of shortcut split zones. The lazy tumble step passes the course-edge switch to both crash bodies, preserving these floors after the step loads and the legacy rule when the switch is off. `waterLevelOf` keeps its existing signature and legacy network-level behavior. The full ground sweep requires zero mismatches; its former known-violation list is removed. Negative controls still catch deliberately wrong floors. First-load size and replay-hash inclusion need the coordinator's bundle check after the loading change. Not phone-verified.
