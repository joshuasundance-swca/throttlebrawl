---
kind: changed
audience: dev
---
The build writes the road data it ships as JSON files on one line instead of pretty-printed, so the files a race fetches are about a fifth smaller. The whole build drops from 5.31 MB to 5.04 MB under the 6 MB limit, which stays where it is.
