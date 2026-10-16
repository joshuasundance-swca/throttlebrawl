---
kind: fixed
audience: dev
---

Lake Samish's shore checks now follow the shore the renderer actually draws. Dock coverage measures
the flat bank where a dock can stand, excluding the sloped ends, and the drop check probes the closed
wall face instead of relying on a mesh vertex landing within a fixed radius.
