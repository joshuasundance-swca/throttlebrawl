---
kind: dev
audience: dev
---
Two browser tests that failed at random on loaded CI runners are steadier, with nothing loosened. The input touch test now waits until the recorded input reaches the expected stick, brake and release state instead of reading exactly 12 ticks later, and it judges the slow drag against the pointer events the page actually received: an attempt the runner delivered as a fast swipe proves nothing and is sent again (up to 3 times), while a slow delivery that still kicks fails. The narrative bubble test reads the bubble's box, text and style in one go while it is up, before the slow screenshot, because a 2 s bubble could vanish while SwiftShader drew the screenshot.
