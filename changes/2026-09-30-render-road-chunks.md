---
kind: changed
audience: dev
---
The road is now built in 512 m square chunks instead of one big mesh per material, and the camera stops drawing at 760 m, just past where the fog hides everything. Road the camera cannot see is skipped, so a longer road no longer makes every frame slower: a 12 km test road costs a frame the same as a 3.6 km one. This unblocks the longer race routes.
