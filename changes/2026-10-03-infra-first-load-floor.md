---
kind: dev
audience: dev
---
The perf check now holds a pull request to a floor of 10 KB of first-load JavaScript headroom.

- Why: the 500 KB budget was crossed 4 times on 10-02 and 10-03. Each PR fit on its own, and main went red when they merged together.
- What fails: on a pull request, a build that grows the first-load JavaScript and leaves under 10 KB of headroom. The message says "this PR leaves N KB of headroom; move something off the first load".
- What never fails it:
  - main's pushes, which keep the 500 KB hard limit alone;
  - a PR that does not grow the first load. If main itself drifts inside the floor, only the PR that adds to it goes red, never every PR or the one that shrinks it.
- A PR whose change against main could not be measured is held to the floor.
- Main is about 401 KB today (99 KB of headroom), so nothing trips.
- Every perf run now prints whether the floor held or was not applied.

The page also preloads the Keys' hand-made road data. #380 moved those 23 JSON files off the first-load JavaScript, and the app fetched them only after its entry script had run. That cost the start screen one round trip. The built `index.html` now carries a fetch preload for each file, so its download starts with the page.
