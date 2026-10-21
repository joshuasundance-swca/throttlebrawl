---
kind: changed
audience: dev
---

The startup layout check now permits a build label to yield at any screen size only when both corners would cover startup words. It also checks those words when the label is visible. This replaces a viewport-specific visibility assumption that blocked a dependency update; control clearance and planted-overlap checks remain in place. Game behavior is unchanged.
