---
kind: fixed
audience: dev
---
The route picker now updates its overflow arrows after resize-observer delivery. Showing those arrows changes the watched row's width; writing during delivery could leave resize notifications undelivered and put a browser error in the debug report. Repeated notifications share one pending update, which reads the current row size when it runs. Draws and scrolling still update the arrows immediately.

A focused test invokes the real picker's observer callback and records its class and button-state changes. It checks that observer delivery makes no such writes, that the deferred update uses the latest row position, and that draw and scroll updates remain synchronous. The original callback failed this check. Browser execution is left to CI; not phone-verified.
