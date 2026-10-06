---
kind: dev
audience: dev
---
The browser test that sets every setting, reloads and checks it stuck now runs as three tests in parallel instead of one. As one test it had grown to 6.2 minutes on a slow CI runner (3.4 on a fast one), and the browser slice that holds it hit the job's 10-minute limit four times on 2026-10-06: on a PR run, on two main runs (d08eabba and fc51c02b, which turned main red) and on a bundle train. Every test in the slice had passed each time. Each part first replays the earlier parts' settings with one click each, so every probe still sees the settings the probes before it left, as before. Nothing the test checks changed. Not phone-verified (no game change).
