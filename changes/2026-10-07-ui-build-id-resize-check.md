---
kind: fixed
audience: dev
---
The menu's build-ID check now lets its queued resize layout finish before deciding whether to scroll to the fallback build line. At normal Text size, changing from 915×412 to 854×480 can make the menu scroll: checking visibility before that update skipped the newly shown line and then reported no build ID.

The check still requires a whole build ID painted on screen, covering no control, card, title or text. A focused browser regression checks the fitting-to-scrolling transition and its layout preconditions. No game layout or visibility rule changed. Browser execution remains CI-only for this change; not phone-verified.
