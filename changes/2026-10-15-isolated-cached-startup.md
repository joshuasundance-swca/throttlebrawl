---
kind: dev
audience: dev
---
The cached-startup timing case runs in the existing serial performance tier. It previously shared
a runner with another software-rendered game. The entire case moves, including its unchanged
five-second production first-visible assertion, held worker navigation, HTTP error, cache integrity,
usable-menu, hidden-menu and offline-race controls. Other offline/update tests retain their browser
tier coverage and share the same cache inspection helper.

Every full gate still runs this case. This changes the measurement context; it does not establish
the cause of earlier misses, promise phone timing, or raise the startup budget.
