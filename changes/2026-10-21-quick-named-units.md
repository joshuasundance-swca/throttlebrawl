---
kind: dev
audience: dev
---

Ordinary train-path quick checks now run the existing planner's named unit tests across the same three jobs. Root manifest or lock changes and uncertain selection keep all units; docs gates and full acceptance still run all units. A validated empty selection reports no selected work. Narrower early feedback can defer an unrelated unit failure to the full train and consume a train attempt; no timing improvement or equivalent early detection is claimed.

Incompatible named-unit and diagnostic inputs force the validation job to run even when diagnostic selection excludes static checks. Unit file-count checks use the runner's final summary, so earlier summary-shaped test output cannot hide a later count mismatch.
