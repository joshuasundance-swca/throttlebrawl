---
kind: dev
audience: dev
---
Main went red when two of run W-T's PRs met: the moving road events (#391) count the signs in a race's props, and law with a personality (#395) puts the cops' END OF JURISDICTION sign in those props in every race, cops on or off. The moving-events test now counts only the road events' own props (ids below `LAW_PROP_ID_BASE`), as the set-piece test already does. No game change.
