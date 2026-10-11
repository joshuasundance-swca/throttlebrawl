---
kind: fixed
audience: dev
---
Make the real-touch kick regression hold animation callbacks until the stamped burst gesture has actually reached the page. The old concurrent command submission did not guarantee the swipe arrived before simulation sampling. The test now verifies native delivery, unchanged held ticks and input counts, first-sample kick flags, direction and actual kick combat outcomes. The natural late-arrival path and exact simulation conversion-window controls remain. This corrects the test's unsupported transport premise without changing production input, combat or frame-loop behavior.
