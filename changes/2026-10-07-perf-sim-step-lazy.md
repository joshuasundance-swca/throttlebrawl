---
kind: dev
audience: dev
---
The simulation's steps load after the first screen. Each system keeps its state, initialization, tuning and snapshot code available for the menu's stationary grid, while its running step lives in a separate lazy chunk. A race waits for that chunk alongside the structure planners. Stepping before preparation throws instead of running with missing rules; a failed preparation can be retried. The public preparation boundary lands first as its own contract change.

The replay code hash covers the simulation chunk and both lazy chunks: structure planners and system steps. Changing a step changes the key. The debug-report browser check independently discovers and hashes both lazy chunks before comparing the copied report and exported replay; its previous calculation omitted the steps. The tests retain the replay round-trip and tampering checks.

Targeted tests examined every event's menu grid without the step chunk, stepping after preparation, unchanged hashes for a UI-only build, changed hashes for simulation, planner and step changes, and exclusion of lazy modules from the first load. After integrating the retry and boardwalk repairs, the local production size check measured 450.3 KB gzip of first-load JavaScript, leaving 49.7 KB under the 500 KB budget. This is a download-size measurement on the dev machine; browser rendering and simulation integration remain CI checks. Not phone-verified.
