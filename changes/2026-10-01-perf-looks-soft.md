---
kind: dev
audience: dev
---
perf: the ink-look perf probe asserts the soft frame-time limits for `kodak` only; `wasteland` and `brush` still run, keep the hard draw-call and triangle gate, and print their frame times every run. All three share one shader program per material and one final pass, and CI measured them the same within noise. On CI's software renderer the ink pass sits close to the p95 limit (66.6 to 133.3 ms across runs against 133.2 ms), so asserting it three times tripled the chance that one frame of noise turns main red, which happened once on main (kodak p95 133.3 ms). No limit changed.
