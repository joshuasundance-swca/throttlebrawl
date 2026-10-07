---
kind: fixed
audience: dev
---
The bark veto browser checks now read the ticker's class, content reference, words and box together. A style chip replacing a bark between separate checks can no longer be mistaken for the line to cut. A controlled check rejects a visible COMBO chip without a content reference.

The existing ticker test seam holds the actual observed race line until its gesture is checked, then releases it before the next line. The mouse press uses the same pointer watcher as the touch check so moving a pointer cannot release that observation hold before the press starts. The 499/500 ms threshold, steering-zone exclusion, selected line, saved veto and page-error checks remain strict. Browser execution is left to CI; not phone-verified.
