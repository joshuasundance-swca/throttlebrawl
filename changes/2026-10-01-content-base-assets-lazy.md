---
kind: dev
audience: dev
---
The base pack's asset data files (anything under `packs/base/assets/` that is JSON, such as the coming horizon backdrop) are no longer bundled into the first load. They are not content entries, and the other packs' asset files were already left out the same way; whoever needs one loads it when needed.
