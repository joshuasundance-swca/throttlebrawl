---
kind: dev
audience: dev
---

Dataset locks can now mark pinned JSON as terrain inputs for one network in the same pack.
These inputs use the existing verified cache and upload commands without becoming separate
runtime assets. CI prepares them before pack checks and test discovery; local setup can use
`npm run assets:fetch -- --build-inputs`. This adds the input contract without activating any terrain.
