---
kind: new
audience: dev
---
The menu has a region picker above the Race button: one chip per region, the Keys picked by default, and the picked region's one-line blurb under them. It stays hidden until app/ hands it the content registry's regions (`UiOptions.regions` or `GameUi.setRegions`); app/ reads the pick from `GameUi.region` or `onRegionChange` and starts the race in an event of that region. A browser test picks each offered region in turn and checks that the race's recorded event belongs to it.
